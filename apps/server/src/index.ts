import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import {
  WS_CLOSE_SERVER_DRAINING,
  type ClientEvent,
  type ServerEvent,
  type TranslationSessionSnapshot,
  isClientEvent,
} from "@websocket-study/shared";

const PORT = Number(process.env.PORT ?? 8080);
const serverInstanceId = randomUUID();
const sockets = new Set<WebSocket>();

type ActiveSession = TranslationSessionSnapshot & {
  timer?: NodeJS.Timeout;
};

const sessionStore = new Map<string, ActiveSession>();
let isDraining = false;

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(isDraining ? 503 : 200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: !isDraining,
        serverInstanceId,
        draining: isDraining,
      }),
    );
    return;
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      message: "WebSocket study server is running",
      serverInstanceId,
    }),
  );
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket) => {
  sockets.add(socket);

  socket.on("message", (raw) => {
    const message = safeParse(raw.toString());
    if (!isClientEvent(message)) {
      send(socket, {
        type: "error",
        payload: { message: "Invalid message format." },
      });
      return;
    }

    if (message.type === "hello") {
      const sessionId = message.payload.sessionId || randomUUID();
      const session =
        sessionStore.get(sessionId) ??
        createSession({
          sessionId,
          lastEventId: 0,
        });

      sessionStore.set(sessionId, session);

      send(socket, {
        type: "welcome",
        payload: {
          sessionId,
          serverInstanceId,
          resumed: message.payload.lastEventId > 0,
          lastEventId: session.lastEventId,
        },
      });
      return;
    }

    if (message.type === "ping") {
      send(socket, {
        type: "pong",
        payload: { ts: message.payload.ts },
      });
      return;
    }

    if (message.type === "start_translation") {
      if (isDraining) {
        send(socket, {
          type: "server_draining",
          payload: {
            retryAfterMs: 1500,
            reason: "Deployment in progress. Reconnect to continue automatically.",
          },
        });
        socket.close(WS_CLOSE_SERVER_DRAINING, "server draining");
        return;
      }

      const session = createSession({
        sessionId: message.payload.sessionId,
        sourceText: message.payload.sourceText,
        sourceLanguage: message.payload.sourceLanguage,
        targetLanguage: message.payload.targetLanguage,
      });

      sessionStore.set(session.sessionId, session);
      session.lastEventId += 1;

      send(socket, {
        type: "translation_started",
        payload: {
          eventId: session.lastEventId,
          sourceText: session.sourceText,
        },
      });

      startStreamingTranslation(session, socket);
    }
  });

  socket.on("close", () => {
    sockets.delete(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint ws://localhost:${PORT}/ws`);
  console.log(`Server instance ${serverInstanceId}`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (isDraining) {
      return;
    }

    isDraining = true;
    console.log(`[${signal}] draining websocket server`);

    broadcast({
      type: "server_draining",
      payload: {
        retryAfterMs: 1500,
        reason: "Server deployment detected. Client will reconnect.",
      },
    });

    for (const socket of sockets) {
      socket.close(WS_CLOSE_SERVER_DRAINING, "server draining");
    }

    setTimeout(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    }, 500);
  });
}

function createSession(partial: Partial<TranslationSessionSnapshot> & { sessionId: string }): ActiveSession {
  return {
    sessionId: partial.sessionId,
    sourceText: partial.sourceText ?? "",
    translatedText: partial.translatedText ?? "",
    sourceLanguage: partial.sourceLanguage ?? "ko",
    targetLanguage: partial.targetLanguage ?? "en",
    status: partial.status ?? "idle",
    lastEventId: partial.lastEventId ?? 0,
  };
}

function startStreamingTranslation(session: ActiveSession, socket: WebSocket) {
  clearTimeout(session.timer);

  session.status = "running";
  session.translatedText = "";

  const translatedChunks = session.sourceText
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => `[${session.targetLanguage}:${index + 1}] ${word}`);

  let cursor = 0;

  const tick = () => {
    const chunk = translatedChunks[cursor];
    if (!chunk) {
      session.status = "completed";
      session.lastEventId += 1;
      send(socket, {
        type: "translation_completed",
        payload: {
          eventId: session.lastEventId,
          translatedText: session.translatedText.trim(),
        },
      });
      return;
    }

    session.translatedText = `${session.translatedText} ${chunk}`.trim();
    session.lastEventId += 1;

    send(socket, {
      type: "translation_chunk",
      payload: {
        eventId: session.lastEventId,
        chunk,
        accumulatedText: session.translatedText,
        done: cursor === translatedChunks.length - 1,
      },
    });

    cursor += 1;
    session.timer = setTimeout(tick, 450);
  };

  session.timer = setTimeout(tick, 250);
}

function send(socket: WebSocket, event: ServerEvent) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

function broadcast(event: ServerEvent) {
  for (const socket of sockets) {
    send(socket, event);
  }
}

function safeParse(raw: string): ClientEvent | null {
  try {
    return JSON.parse(raw) as ClientEvent;
  } catch {
    return null;
  }
}
