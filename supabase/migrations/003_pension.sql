-- 연금복권720+ + purchases.product
alter table public.purchases
  add column if not exists product text not null default 'lotto'
    check (product in ('lotto', 'pension'));

alter table public.purchases
  add column if not exists pension_tickets jsonb;

alter table public.purchases
  add column if not exists pension_settlements jsonb;

alter table public.purchases
  alter column tickets set default '[]'::jsonb;

create index if not exists purchases_product_idx on public.purchases (product);

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
