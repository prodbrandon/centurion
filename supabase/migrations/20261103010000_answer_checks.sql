-- AI Answer Check runs: what AI assistants told shoppers about a store, compared with its catalog.
-- result holds the full AnswerCheckRun (packages/core/src/answer-check/types.ts), including each
-- answer and the catalog fact it was checked against. Only live runs are stored; sample (fixture)
-- runs are rebuilt on demand and never saved.

create table answer_checks (
  id            uuid primary key default gen_random_uuid(),
  shop_id       uuid not null references shops(id) on delete cascade,
  mode          text not null check (mode in ('live', 'fixture')),
  asked         integer not null,
  contradictions integer not null,
  result        jsonb not null,
  created_at    timestamptz not null default now()
);
create index answer_checks_shop_created_idx on answer_checks (shop_id, created_at desc);

alter table answer_checks enable row level security;
