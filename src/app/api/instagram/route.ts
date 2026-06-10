import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Haalt volgers + recente posts op via de Instagram Graph API.
// Vereist twee env vars (Instagram Business/Creator-account gekoppeld aan
// een Facebook-pagina):
//   IG_USER_ID       — het Instagram Business account-id
//   IG_ACCESS_TOKEN  — long-lived access token met instagram_basic
// Zonder die vars valt het scherm terug op een statisch "volg ons"-blok.

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

export async function GET() {
  const token = process.env.IG_ACCESS_TOKEN;
  const uid = process.env.IG_USER_ID;

  if (!token || !uid) {
    return NextResponse.json({ configured: false } satisfies IgData);
  }

  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.data);
  }

  try {
    const fields =
      "username,followers_count,media_count,media.limit(9){media_url,permalink,media_type,thumbnail_url}";
    const url =
      `https://graph.facebook.com/v19.0/${uid}` +
      `?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;

    const res = await fetch(url, { cache: "no-store" });
    const j = await res.json();

    if (j.error) {
      return NextResponse.json({ configured: true, error: j.error.message } satisfies IgData);
    }

    const media = ((j.media?.data ?? []) as Array<Record<string, string>>)
      .map((m) => ({
        id: m.id,
        permalink: m.permalink,
        image: m.media_type === "VIDEO" ? m.thumbnail_url : m.media_url,
      }))
      .filter((m) => m.image);

    const data: IgData = {
      configured: true,
      username: j.username ?? "blisstoshine",
      followers: j.followers_count ?? null,
      mediaCount: j.media_count ?? null,
      media,
    };
    cache = { at: Date.now(), data };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({
      configured: true,
      error: e instanceof Error ? e.message : String(e),
    } satisfies IgData);
  }
}
