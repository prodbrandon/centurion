-- Agent Checkout Test runs: the step log of a shopping agent on a storefront, up to (never past) checkout.
-- Together these rows are the failure corpus: which step blocked or slowed agents, and why. Rows from the
-- local test page have target_kind = 'test_page' and no shop. Corpus queries across stores group by
-- failure_kind and step title only, never by store.

create table checkout_runs (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid references shops(id) on delete cascade,
  target_url    text not null,
  target_kind   text not null check (target_kind in ('test_page', 'storefront')),
  agent         text not null,
  result        text not null check (result in ('reached_checkout', 'blocked')),
  failed_step   integer,
  failure_kind  text,                          -- title of the blocking step, e.g. 'Add to cart'
  problems      integer not null,
  steps         jsonb not null,                -- CheckoutStep[]
  video_path    text,                          -- local file; videos are never stored in the database
  result_json   jsonb not null,                -- full CheckoutRunResult
  started_at    timestamptz not null,
  finished_at   timestamptz not null
);
create index checkout_runs_shop_started_idx on checkout_runs (shop_id, started_at desc);
create index checkout_runs_failure_idx on checkout_runs (failure_kind) where result = 'blocked';

alter table checkout_runs enable row level security;
