export declare const WS_CLOSE_SERVER_DRAINING: 4010;

export type ClientEvent =
  | {
      type: "hello";
      payload: {
        sessionId: string;
        lastEventId: number;
      };
    }
  | {
      type: "start_translation";
      payload: {
        sessionId: string;
        sourceText: string;
        sourceLanguage: string;
        targetLanguage: string;
      };
    }
  | {
      type: "ping";
      payload: {
        ts: number;
      };
    };

export type ServerEvent =
  | {
      type: "welcome";
      payload: {
        sessionId: string;
        serverInstanceId: string;
        resumed: boolean;
        lastEventId: number;
      };
    }
  | {
      type: "translation_started";
      payload: {
        eventId: number;
        sourceText: string;
      };
    }
  | {
      type: "translation_chunk";
      payload: {
        eventId: number;
        chunk: string;
        accumulatedText: string;
        done: boolean;
      };
    }
  | {
      type: "translation_completed";
      payload: {
        eventId: number;
        translatedText: string;
      };
    }
  | {
      type: "server_draining";
      payload: {
        retryAfterMs: number;
        reason: string;
      };
    }
  | {
      type: "pong";
      payload: {
        ts: number;
      };
    }
  | {
      type: "error";
      payload: {
        message: string;
      };
    };

export type TranslationSessionSnapshot = {
  sessionId: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  status: "idle" | "running" | "completed";
  lastEventId: number;
};

export declare function isClientEvent(value: unknown): value is ClientEvent;
