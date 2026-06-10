import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Levert volgers + recente posts voor het grote scherm. Twee mogelijke bronnen:
//
// 1. Behold.so (makkelijkst) — verbind Instagram met één klik, plak de
//    JSON-feed URL in env var IG_FEED_URL. Bevat volgers + posts.
//
// 2. Instagram Graph API — env IG_USER_ID + IG_ACCESS_TOKEN.
//
// Zonder bron valt het scherm terug op een "volg ons"-QR.

type IgData = {
  configured: boolean;
  username?: string;
  followers?: number | null;
  mediaCount?: number | null;
  media?: { id: string; permalink: string; image: string }[];
  error?: string;
};

let cache: { at: number; data: IgData } | null = null;
const TTL = 60_000;

function pick<T>(...vals: (T | undefined | null)[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null) return v as T;
  return undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeFeed(j: any): IgData {
  const followers = pick<number>(
    j?.profile?.followersCount,
    j?.followersCount,
    j?.followers_count
  );
  const username = pick<string>(j?.profile?.username, j?.username) ?? "blisstoshine";
  const rawPosts: any[] = Array.isArray(j) ? j : pick<any[]>(j?.posts, j?.data) ?? [];

  const media = rawPosts
    .map((p, i) => {
      const isVideo = (p?.mediaType ?? p?.media_type) === "VIDEO";
      const image = pick<string>(
        isVideo ? p?.thumbnailUrl : undefined,
        isVideo ? p?.thumbnail_url : undefined,
        p?.sizes?.medium?.mediaUrl,
        p?.mediaUrl,
        p?.media_url,
        p?.thumbnailUrl,
        p?.thumbnail_url
      );
      return {
        id: String(pick<string>(p?.id, p?.permalink) ?? i),
        permalink: pick<string>(p?.permalink, p?.link) ?? "#",
        image: image ?? "",
      };
    })
    .filter((m) => m.image)
    .slice(0, 9);

  return {
    configured: true,
    username,
    followers: followers ?? null,
    mediaCount: rawPosts.length || null,
    media,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function fromBehold(feedUrl: string): Promise<IgData> {
  const res = await fetch(feedUrl, { cache: "no-store" });
  if (!res.ok) return { configured: true, error: `feed HTTP ${res.status}` };
  return normalizeFeed(await res.json());
}

async function fromGraph(uid: string, token: string): Promise<IgData> {
  const fields =
    "username,followers_count,media_count,media.limit(9){media_url,permalink,media_type,thumbnail_url}";
  const url =
    `https://graph.facebook.com/v19.0/${uid}` +
    `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { cache: "no-store" });
  const j = await res.json();
  if (j.error) return { configured: true, error: j.error.message };
  return normalizeFeed({ profile: { username: j.username, followersCount: j.followers_count }, posts: j.media?.data });
}

export async function GET() {
  const feedUrl = process.env.IG_FEED_URL;
  const token = process.env.IG_ACCESS_TOKEN;
  const uid = process.env.IG_USER_ID;

  if (!feedUrl && !(token && uid)) {
    return NextResponse.json({ configured: false } satisfies IgData);
  }
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const data = feedUrl ? await fromBehold(feedUrl) : await fromGraph(uid!, token!);
    if (!data.error) cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      configured: true,
      error: e instanceof Error ? e.message : String(e),
    } satisfies IgData);
  }
}
