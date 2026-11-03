-- Weekly Fix: each change applied to a store, with the exact description before and after (for undo) and
-- the AI revenue baseline of the product and its holdouts (for measuring the effect).

create table weekly_fixes (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  fix_key       text not null,                 -- rule:product:field
  product_id    text not null,
  product_title text not null,
  status        text not null check (status in ('applied', 'undone')),
  suggestion    jsonb not null,                -- FixSuggestion
  before_html   text not null,
  after_html    text not null,
  baseline      jsonb not null,                -- FixBaseline
  applied_at    timestamptz not null,
  undone_at     timestamptz
);
create index weekly_fixes_shop_applied_idx on weekly_fixes (shop_id, applied_at desc);
-- A fix can be live on a product only once at a time.
create unique index weekly_fixes_one_applied_idx on weekly_fixes (shop_id, fix_key) where status = 'applied';

alter table weekly_fixes enable row level security;
