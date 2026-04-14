create table if not exists translation_jobs (
  id uuid primary key,
  session_id varchar(64) not null,
  source_language varchar(16) not null,
  target_language varchar(16) not null,
  source_text text not null,
  translated_text text not null default '',
  status varchar(16) not null default 'running',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists translation_jobs_session_id_idx
  on translation_jobs (session_id);

create table if not exists translation_events (
  id bigserial primary key,
  job_id uuid not null references translation_jobs(id) on delete cascade,
  event_id integer not null,
  chunk text not null,
  created_at timestamptz not null default now(),
  unique (job_id, event_id)
);
