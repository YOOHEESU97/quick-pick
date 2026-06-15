-- quick-pick Supabase schema (신규 프로젝트)
-- Supabase Dashboard → SQL Editor 에서 실행

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  level text not null check (level in ('info', 'success', 'warn', 'error')),
  message text not null,
  meta jsonb
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text not null default 'lotto' check (product in ('lotto', 'pension')),
  round integer not null,
  method text not null check (method in ('ai', 'statistical')),
  tickets jsonb not null default '[]'::jsonb,
  pension_tickets jsonb,
  ticket_count integer not null,
  amount integer not null,
  message text not null default '',
  success boolean not null default true,
  settled_at timestamptz,
  prize_total integer,
  best_rank integer,
  settlements jsonb,
  pension_settlements jsonb
);

create table if not exists public.lotto_draws (
  round integer primary key,
  draw_date text not null,
  numbers jsonb not null,
  bonus integer not null,
  prize_rank1 bigint not null default 0,
  prize_rank2 bigint not null default 0,
  prize_rank3 bigint not null default 0,
  prize_rank4 bigint not null default 0,
  prize_rank5 bigint not null default 0,
  synced_at timestamptz not null default now()
);

create index if not exists activity_logs_created_at_idx
  on public.activity_logs (created_at desc);

create index if not exists purchases_created_at_idx
  on public.purchases (created_at desc);

create index if not exists purchases_round_idx
  on public.purchases (round);

create index if not exists purchases_product_idx
  on public.purchases (product);

create table if not exists public.pension_draws (
  round integer primary key,
  draw_date text not null,
  first_group integer not null,
  first_number text not null,
  bonus_number text,
  prize_rank1 bigint not null default 0,
  prize_rank2 bigint not null default 0,
  prize_rank3 bigint not null default 0,
  prize_rank4 bigint not null default 0,
  prize_rank5 bigint not null default 0,
  prize_rank6 bigint not null default 0,
  prize_rank7 bigint not null default 0,
  prize_bonus bigint not null default 0,
  synced_at timestamptz not null default now()
);

create index if not exists pension_draws_synced_at_idx
  on public.pension_draws (synced_at desc);

alter table public.pension_draws enable row level security;

create index if not exists lotto_draws_synced_at_idx
  on public.lotto_draws (synced_at desc);

alter table public.activity_logs enable row level security;
alter table public.purchases enable row level security;
alter table public.lotto_draws enable row level security;
