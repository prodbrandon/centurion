-- v0 schema: shops, orders, AI attributions, signature versions, report runs.
-- Mirrors packages/attribution/src/types.ts.
--
-- Access: only the backend (service role) reads and writes these tables. RLS is on with
-- no policies, so the public anon key gets nothing. Add policies only if the browser
-- ever needs direct reads.

-- One row per installed Shopify store.
create table shops (
  id            uuid primary key default gen_random_uuid(),
  shop_domain   text not null unique,          -- x.myshopify.com
  name          text,
  currency      text,
  -- Shopify offline access token, encrypted by the app before insert. Never store plaintext.
  access_token_encrypted text,
  scopes        text[] not null default '{}',
  installed_at  timestamptz not null default now(),
  uninstalled_at timestamptz
);

-- Version history of data/signatures.json. Each promote creates a new version.
create table signature_versions (
  version       text primary key,              -- e.g. 2026-10-23.1
  file          jsonb not null,                -- full SignatureFile
  created_at    timestamptz not null default now(),
  created_by    text not null
);

-- One row per engine run (report or discover) so trends and audits can point to a run.
create table runs (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  kind          text not null check (kind in ('report', 'discover')),
  signature_version text references signature_versions(version),
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'running' check (status in ('running', 'done', 'failed')),
  error         text,
  summary       jsonb,                         -- buildReport() output
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index runs_shop_started_idx on runs (shop_id, started_at desc);

-- Trimmed Shopify orders (types.ts Order). Kept so we can re-classify when signatures change.
create table orders (
  shop_id       uuid not null references shops(id) on delete cascade,
  id            text not null,                 -- Shopify GID
  name          text not null,                 -- #1001
  created_at    timestamptz not null,
  total         numeric(12, 2) not null,
  currency      text not null,
  channel       text,
  first_visit   jsonb,
  last_visit    jsonb,
  line_items    jsonb not null default '[]',
  fetched_at    timestamptz not null default now(),
  primary key (shop_id, id)
);
create index orders_shop_created_idx on orders (shop_id, created_at desc);

-- Classifier output per order per run (types.ts Attribution). Candidates are stored
-- with is_ai = false and evidence = 'candidate', and are never summed as AI revenue.
create table attributions (
  run_id        uuid not null references runs(id) on delete cascade,
  shop_id       uuid not null,
  order_id      text not null,
  is_ai         boolean not null,
  source        text,                          -- signature id
  touch         text check (touch in ('first', 'last', 'both', 'checkout')),
  evidence      text check (evidence in ('checkout_in_ai', 'referrer', 'utm', 'candidate')),
  proof         text[] not null default '{}',
  primary key (run_id, order_id),
  foreign key (shop_id, order_id) references orders(shop_id, id) on delete cascade
);
create index attributions_shop_ai_idx on attributions (shop_id, is_ai);

alter table shops              enable row level security;
alter table signature_versions enable row level security;
alter table runs               enable row level security;
alter table orders             enable row level security;
alter table attributions       enable row level security;
