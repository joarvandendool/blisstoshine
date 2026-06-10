import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lichte diagnose voor de eventdag: bevestigt of env vars staan en of de
// database bereikbaar is met de juiste tabellen. Lekt GEEN secrets — alleen
// "aanwezig ja/nee" en publieke (NEXT_PUBLIC_) waarden.
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ADMIN_PIN: Boolean(process.env.ADMIN_PIN),
    NEXT_PUBLIC_QR_TARGET_URL: process.env.NEXT_PUBLIC_QR_TARGET_URL ?? null,
    NEXT_PUBLIC_GOAL_CENTS: process.env.NEXT_PUBLIC_GOAL_CENTS ?? null,
  };

  const db: {
    reachable: boolean;
    donationsTable: string;
    settingsTable: string;
    adminPin: string;
    donationCount: number | null;
    totalCents: number | null;
  } = {
    reachable: false,
    donationsTable: "onbekend",
    settingsTable: "onbekend",
    adminPin: "onbekend",
    donationCount: null,
    totalCents: null,
  };

  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );

      const donRes = await sb
        .from("donations")
        .select("amount_cents", { count: "exact" });
      if (donRes.error) {
        db.donationsTable = `fout: ${donRes.error.message}`;
      } else {
        db.reachable = true;
        db.donationsTable = "ok";
        db.donationCount = donRes.count ?? donRes.data?.length ?? 0;
        db.totalCents = (donRes.data ?? []).reduce(
          (s, r) => s + (r.amount_cents as number),
          0
        );
      }

      const setRes = await sb.from("settings").select("id").limit(1);
      db.settingsTable = setRes.error ? `fout: ${setRes.error.message}` : "ok";

      // admin-PIN kan in env var óf in admin_config tabel staan
      if (env.ADMIN_PIN) {
        db.adminPin = "via env var";
      } else {
        const pinRes = await sb.from("admin_config").select("id").limit(1);
        db.adminPin = pinRes.error
          ? `niet ingesteld (${pinRes.error.message})`
          : pinRes.data && pinRes.data.length > 0
            ? "via database"
            : "niet ingesteld";
      }
    } catch (e) {
      db.donationsTable = `verbinding mislukt: ${
        e instanceof Error ? e.message : String(e)
      }`;
    }
  } else {
    db.donationsTable = "supabase env vars ontbreken";
    db.settingsTable = "supabase env vars ontbreken";
  }

  const pinReady = db.adminPin === "via env var" || db.adminPin === "via database";

  const ready =
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    env.SUPABASE_SERVICE_ROLE_KEY &&
    pinReady &&
    db.donationsTable === "ok" &&
    db.settingsTable === "ok";

  return NextResponse.json(
    { ready, env, db, checkedAt: new Date().toISOString() },
    { status: ready ? 200 : 503 }
  );
}
