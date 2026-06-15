-- 기존 Supabase 프로젝트에 추가 실행 (이미 schema.sql 실행한 경우)

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

alter table public.purchases add column if not exists settled_at timestamptz;
alter table public.purchases add column if not exists prize_total integer;
alter table public.purchases add column if not exists best_rank integer;
alter table public.purchases add column if not exists settlements jsonb;

create index if not exists purchases_round_idx on public.purchases (round);
create index if not exists lotto_draws_synced_at_idx on public.lotto_draws (synced_at desc);

alter table public.lotto_draws enable row level security;
