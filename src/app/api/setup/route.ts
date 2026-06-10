import { NextResponse } from "next/server";
import { Client } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Eenmalig setup-endpoint: maakt de tabellen aan, zet realtime aan, seedt
// settings + admin-PIN en draait een end-to-end zelftest. Beveiligd met een
// token. Wordt na gebruik weer uit de codebase verwijderd.
const SETUP_TOKEN = "bts-init-9q2r7x";

const SCHEMA_SQL = `
create table if not exists public.donations (
  id              uuid primary key default gen_random_uuid(),
  first_name      text,
  amount_cents    integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  message         text,
  show_on_display boolean not null default true,
  source          text not null default 'invoer',
  created_at      timestamptz not null default now()
);
create index if not exists donations_created_at_idx on public.donations (created_at desc);

create table if not exists public.settings (
  id          integer primary key default 1,
  goal_cents  integer not null default 1000000,
  event_date  date,
  reset_at    timestamptz,
  updated_at  timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

create table if not exists public.admin_config (
  id          integer primary key default 1,
  pin         text not null,
  updated_at  timestamptz not null default now(),
  constraint admin_config_singleton check (id = 1)
);

alter table public.donations    enable row level security;
alter table public.settings     enable row level security;
alter table public.admin_config enable row level security;

drop policy if exists "donations_select_all" on public.donations;
create policy "donations_select_all" on public.donations for select using (true);

drop policy if exists "settings_select_all" on public.settings;
create policy "settings_select_all" on public.settings for select using (true);
-- admin_config: GEEN public select policy -> anon kan de pin niet lezen.
`;

type Step = { step: string; ok: boolean; detail?: string };

function pickConnString(): { url: string; varName: string } | null {
  const candidates = [
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL",
    "DATABASE_URL",
    "POSTGRES_PRISMA_URL",
  ];
  for (const name of candidates) {
    const v = process.env[name];
    if (v) return { url: v, varName: name };
  }
  return null;
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (token !== SETUP_TOKEN) {
    return NextResponse.json({ error: "Ongeldige token" }, { status: 401 });
  }

  const conn = pickConnString();
  if (!conn) {
    const seen = [
      "POSTGRES_URL_NON_POOLING",
      "POSTGRES_URL",
      "DATABASE_URL",
      "POSTGRES_PRISMA_URL",
    ].filter((n) => Boolean(process.env[n]));
    return NextResponse.json(
      {
        error: "Geen Postgres connection string gevonden in env vars",
        gevonden_db_vars: seen,
      },
      { status: 500 }
    );
  }

  const steps: Step[] = [];
  const client = new Client({
    connectionString: conn.url,
    ssl: { rejectUnauthorized: false },
  });

  let newPin: string | null = null;

  try {
    await client.connect();
    steps.push({ step: `verbinding (${conn.varName})`, ok: true });

    // 1. Schema (tabellen, indexen, RLS, policies)
    await client.query(SCHEMA_SQL);
    steps.push({ step: "schema (tabellen + RLS)", ok: true });

    // 2. Realtime publication — tolereer 'already member'
    try {
      await client.query(
        "alter publication supabase_realtime add table public.donations"
      );
      steps.push({ step: "realtime aan", ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const already = /already a member|already member|bestaat al/i.test(msg);
      steps.push({
        step: "realtime aan",
        ok: already,
        detail: already ? "was al ingeschakeld" : msg,
      });
    }

    // 3. Seed settings (goal €10.000)
    await client.query(
      "insert into public.settings (id, goal_cents) values (1, 1000000) on conflict (id) do nothing"
    );
    steps.push({ step: "settings geseed (doel €10.000)", ok: true });

    // 4. Seed admin-PIN (alleen als nog niet aanwezig)
    const existing = await client.query("select pin from public.admin_config where id = 1");
    if (existing.rows.length === 0) {
      newPin = String(Math.floor(1000 + Math.random() * 9000));
      await client.query(
        "insert into public.admin_config (id, pin) values (1, $1) on conflict (id) do nothing",
        [newPin]
      );
      steps.push({ step: "admin-PIN aangemaakt", ok: true });
    } else {
      steps.push({ step: "admin-PIN", ok: true, detail: "was al ingesteld" });
    }

    // 5. Zelftest: insert -> count -> delete
    const ins = await client.query(
      "insert into public.donations (first_name, amount_cents, message, show_on_display, source) values ($1,$2,$3,$4,$5) returning id",
      ["__setup_test__", 500, "zelftest", false, "invoer"]
    );
    const testId = ins.rows[0].id as string;
    const cnt = await client.query("select count(*)::int as n from public.donations");
    await client.query("delete from public.donations where id = $1", [testId]);
    steps.push({
      step: "zelftest insert/read/delete",
      ok: true,
      detail: `tabel bereikbaar, ${cnt.rows[0].n} rij(en) tijdens test`,
    });

    return NextResponse.json({
      ok: true,
      message: "Setup voltooid. Verwijder dit endpoint hierna.",
      pin: newPin,
      pinHint: newPin
        ? "Bewaar deze admin-PIN. Je kunt 'm later wijzigen."
        : "Admin-PIN was al ingesteld; ongewijzigd gelaten.",
      steps,
    });
  } catch (e) {
    steps.push({
      step: "FOUT",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
    return NextResponse.json({ ok: false, steps }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
