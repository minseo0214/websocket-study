create table if not exists translation_jobs (
  id uuid primary key,
  session_id varchar(64) not null unique,
  source_language varchar(16) not null,
  target_language varchar(16) not null,
  source_text text not null,
  translated_text text not null default '',
  last_event_id integer not null default 0,
  status varchar(16) not null default 'running',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists translation_events (
  id bigserial primary key,
  job_id uuid not null references translation_jobs(id) on delete cascade,
  event_id integer not null,
  event_type varchar(32) not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (job_id, event_id)
);

create index if not exists translation_events_job_id_event_id_idx
  on translation_events (job_id, event_id);
