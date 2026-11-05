-- Background report runs: a heartbeat so a long run is not mistaken for a stopped one, and at most one
-- running report per shop (a second Run report press joins the run already going).

alter table runs add column heartbeat_at timestamptz;

-- Report runs execute inside the app process, so none survive the deploy that applies this migration.
update runs set status = 'failed', error = 'The report stopped before finishing (the app restarted). Run it again.', finished_at = now()
where status = 'running' and kind = 'report';

create unique index runs_one_running_report_idx on runs (shop_id) where kind = 'report' and status = 'running';
