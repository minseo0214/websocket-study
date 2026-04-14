import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";
import {
  findTranslationJob,
  getTranslationEventsAfter,
  healthcheckDatabase,
  startTranslationJob,
} from "@websocket-study/db";
import {
  WS_CLOSE_SERVER_DRAINING,
  type ClientEvent,
  type ServerEvent,
  isClientEvent,
} from "@websocket-study/shared";
import { TranslationRuntime } from "./translation-runtime.js";

const PORT = Number(process.env.PORT ?? 8080);
const serverInstanceId = randomUUID();
const sockets = new Set<WebSocket>();
const sessionSockets = new Map<string, Set<WebSocket>>();
const socketSessions = new Map<WebSocket, string>();

let isDraining = false;

const runtime = new TranslationRuntime({
  emitToSession(sessionId, event) {
    const targets = sessionSockets.get(sessionId);
    if (!targets) {
      return;
    }

    for (const socket of targets) {
      send(socket, event);
    }
  },
  isDraining: () => isDraining,
});

const httpServer = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    try {
      await healthcheckDatabase();
      res.writeHead(isDraining ? 503 : 200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: !isDraining,
          serverInstanceId,
          draining: isDraining,
        }),
      );
    } catch (error) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: false,
          serverInstanceId,
          draining: isDraining,
          error: error instanceof Error ? error.message : "database unavailable",
        }),
      );
    }
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
    void handleClientEvent(socket, raw.toString());
  });

  socket.on("close", () => {
    unregisterSocket(socket);
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

    runtime.stopAll();
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

async function handleClientEvent(socket: WebSocket, raw: string) {
  const message = safeParse(raw);
  if (!isClientEvent(message)) {
    send(socket, {
      type: "error",
      payload: { message: "Invalid message format." },
    });
    return;
  }

  if (message.type === "hello") {
    const sessionId = message.payload.sessionId || randomUUID();
    registerSocket(sessionId, socket);

    const session = await findTranslationJob(sessionId);

    send(socket, {
      type: "welcome",
      payload: {
        sessionId,
        serverInstanceId,
        resumed: message.payload.lastEventId > 0,
        lastEventId: session?.lastEventId ?? 0,
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
    if (rejectWhenDraining(socket)) {
      return;
    }

    registerSocket(message.payload.sessionId, socket);

    const { job, startedEvent } = await startTranslationJob({
      sessionId: message.payload.sessionId,
      sourceText: message.payload.sourceText,
      sourceLanguage: message.payload.sourceLanguage,
      targetLanguage: message.payload.targetLanguage,
    });

    send(socket, startedEvent);
    await runtime.start(job);
    return;
  }

  if (message.type === "resume_translation") {
    if (rejectWhenDraining(socket)) {
      return;
    }

    registerSocket(message.payload.sessionId, socket);

    const job = await findTranslationJob(message.payload.sessionId);
    if (!job) {
      send(socket, {
        type: "error",
        payload: {
          message: "No persisted translation job found for this session.",
        },
      });
      return;
    }

    const missedEvents = await getTranslationEventsAfter(message.payload.sessionId, message.payload.lastEventId);
    for (const event of missedEvents) {
      send(socket, event);
    }

    await runtime.resume(job);
  }
}

function registerSocket(sessionId: string, socket: WebSocket) {
  unregisterSocket(socket);
  socketSessions.set(socket, sessionId);

  const existing = sessionSockets.get(sessionId);
  if (existing) {
    existing.add(socket);
    return;
  }

  sessionSockets.set(sessionId, new Set([socket]));
}

function unregisterSocket(socket: WebSocket) {
  const sessionId = socketSessions.get(socket);
  if (!sessionId) {
    return;
  }

  socketSessions.delete(socket);
  const existing = sessionSockets.get(sessionId);
  if (!existing) {
    return;
  }

  existing.delete(socket);
  if (existing.size === 0) {
    sessionSockets.delete(sessionId);
  }
}

function rejectWhenDraining(socket: WebSocket) {
  if (!isDraining) {
    return false;
  }

  send(socket, {
    type: "server_draining",
    payload: {
      retryAfterMs: 1500,
      reason: "Deployment in progress. Reconnect to continue automatically.",
    },
  });
  socket.close(WS_CLOSE_SERVER_DRAINING, "server draining");
  return true;
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
