-- Weekly Fix: each change applied to a store, with the exact description before and after (for undo) and
-- the AI revenue baseline of the product and its holdouts (for measuring the effect). A row is reserved as
-- 'pending' before the store is written, so a store change is never left unrecorded.

create table weekly_fixes (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  fix_key       text not null,                 -- rule:product:field
  product_id    text not null,
  product_title text not null,
  status        text not null check (status in ('pending', 'applied', 'undone')),
  suggestion    jsonb not null,                -- FixSuggestion
  before_html   text,                          -- set when applied
  after_html    text,                          -- as the store saved it
  baseline      jsonb,                         -- FixBaseline
  created_at    timestamptz not null default now(),
  applied_at    timestamptz,
  undone_at     timestamptz,
  check (status = 'pending' or (before_html is not null and after_html is not null and baseline is not null and applied_at is not null))
);
create index weekly_fixes_shop_created_idx on weekly_fixes (shop_id, created_at desc);
-- One fix at a time per store: a second can't start while one is being applied or is live.
create unique index weekly_fixes_one_live_idx on weekly_fixes (shop_id) where status in ('pending', 'applied');

alter table weekly_fixes enable row level security;
