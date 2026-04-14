import {
  appendTranslationChunk,
  completeTranslationJob,
  type TranslationJobRecord,
} from "@websocket-study/db";
import type { ServerEvent } from "@websocket-study/shared";

type RuntimeOptions = {
  emitToSession: (sessionId: string, event: ServerEvent) => void;
  isDraining: () => boolean;
};

type StreamState = {
  jobId: string;
  sessionId: string;
  sourceText: string;
  targetLanguage: string;
  translatedText: string;
  lastEventId: number;
  cursor: number;
  timer?: NodeJS.Timeout;
};

export class TranslationRuntime {
  private readonly streams = new Map<string, StreamState>();

  constructor(private readonly options: RuntimeOptions) {}

  async start(job: TranslationJobRecord) {
    this.stop(job.sessionId);

    const state = this.createState(job);
    this.streams.set(job.sessionId, state);
    this.schedule(state, 250);
  }

  async resume(job: TranslationJobRecord) {
    if (job.status !== "running") {
      return;
    }

    const existing = this.streams.get(job.sessionId);
    if (existing) {
      existing.lastEventId = Math.max(existing.lastEventId, job.lastEventId);
      existing.translatedText = job.translatedText;
      existing.cursor = Math.max(existing.cursor, getCursorFromJob(job));
      return;
    }

    const state = this.createState(job);
    this.streams.set(job.sessionId, state);
    this.schedule(state, 250);
  }

  stop(sessionId: string) {
    const existing = this.streams.get(sessionId);
    if (!existing) {
      return;
    }

    clearTimeout(existing.timer);
    this.streams.delete(sessionId);
  }

  stopAll() {
    for (const sessionId of this.streams.keys()) {
      this.stop(sessionId);
    }
  }

  private createState(job: TranslationJobRecord): StreamState {
    return {
      jobId: job.jobId,
      sessionId: job.sessionId,
      sourceText: job.sourceText,
      targetLanguage: job.targetLanguage,
      translatedText: job.translatedText,
      lastEventId: job.lastEventId,
      cursor: getCursorFromJob(job),
    };
  }

  private schedule(state: StreamState, delayMs: number) {
    state.timer = setTimeout(() => {
      void this.tick(state);
    }, delayMs);
  }

  private async tick(state: StreamState) {
    if (this.options.isDraining()) {
      this.stop(state.sessionId);
      return;
    }

    const translatedChunks = buildTranslatedChunks(state.sourceText, state.targetLanguage);
    const chunk = translatedChunks[state.cursor];

    if (!chunk) {
      const completedEvent = await completeTranslationJob({
        jobId: state.jobId,
        eventId: state.lastEventId + 1,
        translatedText: state.translatedText.trim(),
      });

      this.options.emitToSession(state.sessionId, completedEvent);
      this.streams.delete(state.sessionId);
      return;
    }

    state.translatedText = `${state.translatedText} ${chunk}`.trim();
    state.lastEventId += 1;

    const chunkEvent = await appendTranslationChunk({
      jobId: state.jobId,
      eventId: state.lastEventId,
      chunk,
      accumulatedText: state.translatedText,
      done: state.cursor === translatedChunks.length - 1,
    });

    this.options.emitToSession(state.sessionId, chunkEvent);
    state.cursor += 1;
    this.schedule(state, 450);
  }
}

function buildTranslatedChunks(sourceText: string, targetLanguage: string) {
  return sourceText
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => `[${targetLanguage}:${index + 1}] ${word}`);
}

function getCursorFromJob(job: TranslationJobRecord) {
  if (job.lastEventId <= 1) {
    return 0;
  }

  return job.lastEventId - 1;
}
