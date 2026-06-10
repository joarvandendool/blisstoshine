-- Bliss to Shine donatie-counter schema
-- Plak dit in de Supabase SQL editor (één keer uitvoeren bij setup)

-- ============================================================
-- TABELLEN
-- ============================================================

create table if not exists public.donations (
  id              uuid primary key default gen_random_uuid(),
  first_name      text,
  amount_cents    integer not null check (amount_cents > 0 and amount_cents <= 100000000),
  message         text,
  show_on_display boolean not null default true,
  source          text not null default 'invoer',  -- 'invoer' | 'online' (toekomst)
  created_at      timestamptz not null default now()
);

create index if not exists donations_created_at_idx
  on public.donations (created_at desc);

create table if not exists public.settings (
  id          integer primary key default 1,
  goal_cents  integer not null default 1000000,  -- €10.000
  event_date  date,
  reset_at    timestamptz,                       -- donaties vóór dit moment tellen niet mee
  updated_at  timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

insert into public.settings (id) values (1)
on conflict (id) do nothing;

-- Admin/vrijwilligers-PIN (alternatief voor ADMIN_PIN env var).
-- Bewust een aparte tabel zonder public select-policy, zodat anon de
-- pin NIET kan uitlezen (settings is wel publiek leesbaar).
create table if not exists public.admin_config (
  id          integer primary key default 1,
  pin         text not null,
  updated_at  timestamptz not null default now(),
  constraint admin_config_singleton check (id = 1)
);

-- ============================================================
-- REALTIME inschakelen op donations
-- ============================================================
alter publication supabase_realtime add table public.donations;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.donations    enable row level security;
alter table public.settings     enable row level security;
alter table public.admin_config enable row level security;
-- admin_config krijgt bewust GEEN select-policy: alleen de service_role
-- (server-side API routes) kan de pin lezen.

-- Iedereen mag donations lezen (display + invoer-lijst)
drop policy if exists "donations_select_all" on public.donations;
create policy "donations_select_all"
  on public.donations for select
  using (true);

-- Iedereen mag settings lezen
drop policy if exists "settings_select_all" on public.settings;
create policy "settings_select_all"
  on public.settings for select
  using (true);

-- Schrijfacties lopen via API routes met service_role key (RLS bypasst dan).
-- Geen public INSERT/UPDATE/DELETE policies → veilig.

-- ============================================================
-- HANDIGE VIEW: totaal sinds laatste reset
-- ============================================================
create or replace view public.donation_totals as
select
  coalesce(sum(d.amount_cents), 0)::bigint as total_cents,
  count(*)::int                            as donor_count,
  s.goal_cents,
  s.reset_at
from public.settings s
left join public.donations d
  on (s.reset_at is null or d.created_at >= s.reset_at)
where s.id = 1
group by s.goal_cents, s.reset_at;

grant select on public.donation_totals to anon, authenticated;
