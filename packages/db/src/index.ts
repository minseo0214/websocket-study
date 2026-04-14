import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { ServerEvent, TranslationSessionSnapshot } from "@websocket-study/shared";

export type TranslationJobRecord = TranslationSessionSnapshot & {
  jobId: string;
};

export type StartTranslationInput = {
  sessionId: string;
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
};

type TranslationStatus = TranslationSessionSnapshot["status"];

type JobRow = {
  id: string;
  session_id: string;
  source_text: string;
  translated_text: string;
  source_language: string;
  target_language: string;
  status: TranslationStatus;
  last_event_id: number;
};

type EventRow = {
  event_type: ServerEvent["type"];
  payload: ServerEvent["payload"];
};

const connectionString =
  process.env.DATABASE_URL ?? "postgres://websocket:websocket@localhost:5432/websocket_study";

const pool = new Pool({
  connectionString,
});

export async function healthcheckDatabase() {
  await pool.query("select 1");
}

export async function findTranslationJob(sessionId: string): Promise<TranslationJobRecord | null> {
  const result = await pool.query<JobRow>(
    `
      select
        id,
        session_id,
        source_text,
        translated_text,
        source_language,
        target_language,
        status,
        last_event_id
      from translation_jobs
      where session_id = $1
    `,
    [sessionId],
  );

  return result.rows[0] ? mapJob(result.rows[0]) : null;
}

export async function startTranslationJob(input: StartTranslationInput) {
  return withTransaction(async (client) => {
    const existing = await client.query<{ id: string }>(
      `
        select id
        from translation_jobs
        where session_id = $1
      `,
      [input.sessionId],
    );

    const jobId = existing.rows[0]?.id ?? randomUUID();

    if (existing.rows[0]) {
      await client.query(
        `
          delete from translation_events
          where job_id = $1
        `,
        [jobId],
      );
    }

    await client.query(
      `
        insert into translation_jobs (
          id,
          session_id,
          source_language,
          target_language,
          source_text,
          translated_text,
          last_event_id,
          status,
          updated_at
        )
        values ($1, $2, $3, $4, $5, '', 1, 'running', now())
        on conflict (session_id)
        do update set
          source_language = excluded.source_language,
          target_language = excluded.target_language,
          source_text = excluded.source_text,
          translated_text = '',
          last_event_id = 1,
          status = 'running',
          updated_at = now()
      `,
      [jobId, input.sessionId, input.sourceLanguage, input.targetLanguage, input.sourceText],
    );

    const startedEvent = {
      type: "translation_started" as const,
      payload: {
        eventId: 1,
        sourceText: input.sourceText,
      },
    };

    await insertEvent(client, jobId, startedEvent);

    const job = await client.query<JobRow>(
      `
        select
          id,
          session_id,
          source_text,
          translated_text,
          source_language,
          target_language,
          status,
          last_event_id
        from translation_jobs
        where id = $1
      `,
      [jobId],
    );

    return {
      job: mapJob(job.rows[0]),
      startedEvent,
    };
  });
}

export async function appendTranslationChunk(params: {
  jobId: string;
  eventId: number;
  chunk: string;
  accumulatedText: string;
  done: boolean;
}) {
  return withTransaction(async (client) => {
    const event = {
      type: "translation_chunk" as const,
      payload: {
        eventId: params.eventId,
        chunk: params.chunk,
        accumulatedText: params.accumulatedText,
        done: params.done,
      },
    };

    await insertEvent(client, params.jobId, event);

    await client.query(
      `
        update translation_jobs
        set
          translated_text = $2,
          last_event_id = $3,
          status = 'running',
          updated_at = now()
        where id = $1
      `,
      [params.jobId, params.accumulatedText, params.eventId],
    );

    return event;
  });
}

export async function completeTranslationJob(params: {
  jobId: string;
  eventId: number;
  translatedText: string;
}) {
  return withTransaction(async (client) => {
    const event = {
      type: "translation_completed" as const,
      payload: {
        eventId: params.eventId,
        translatedText: params.translatedText,
      },
    };

    await insertEvent(client, params.jobId, event);

    await client.query(
      `
        update translation_jobs
        set
          translated_text = $2,
          last_event_id = $3,
          status = 'completed',
          updated_at = now()
        where id = $1
      `,
      [params.jobId, params.translatedText, params.eventId],
    );

    return event;
  });
}

export async function getTranslationEventsAfter(sessionId: string, lastEventId: number): Promise<ServerEvent[]> {
  const result = await pool.query<EventRow>(
    `
      select
        e.event_type,
        e.payload
      from translation_events e
      inner join translation_jobs j on j.id = e.job_id
      where j.session_id = $1 and e.event_id > $2
      order by e.event_id asc
    `,
    [sessionId, lastEventId],
  );

  return result.rows.map((row) => ({
    type: row.event_type,
    payload: row.payload,
  })) as ServerEvent[];
}

async function insertEvent(client: PoolClient, jobId: string, event: ServerEvent) {
  const eventId =
    "eventId" in event.payload && typeof event.payload.eventId === "number" ? event.payload.eventId : null;

  if (eventId === null) {
    throw new Error(`Event ${event.type} does not have a numeric eventId.`);
  }

  await client.query(
    `
      insert into translation_events (
        job_id,
        event_id,
        event_type,
        payload
      )
      values ($1, $2, $3, $4::jsonb)
      on conflict (job_id, event_id) do nothing
    `,
    [jobId, eventId, event.type, JSON.stringify(event.payload)],
  );
}

async function withTransaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function mapJob(row: JobRow): TranslationJobRecord {
  return {
    jobId: row.id,
    sessionId: row.session_id,
    sourceText: row.source_text,
    translatedText: row.translated_text,
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    status: row.status,
    lastEventId: row.last_event_id,
  };
}
