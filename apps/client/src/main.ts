import { WS_CLOSE_SERVER_DRAINING, type ClientEvent, type ServerEvent } from "@websocket-study/shared";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found.");
}

app.innerHTML = `
  <main class="layout">
    <section class="panel hero">
      <p class="eyebrow">WebSocket Study</p>
      <h1>실시간 번역 실습 베이스</h1>
      <p class="description">
        서버가 재배포되어도 자동으로 재연결하고, 진행 중인 번역을 다시 시작하는 흐름을 테스트할 수 있습니다.
      </p>
      <div class="status-grid">
        <article>
          <span>연결 상태</span>
          <strong id="connectionStatus">connecting</strong>
        </article>
        <article>
          <span>세션</span>
          <strong id="sessionId">-</strong>
        </article>
        <article>
          <span>서버 인스턴스</span>
          <strong id="serverInstanceId">-</strong>
        </article>
      </div>
    </section>

    <section class="panel composer">
      <label class="field">
        <span>원문</span>
        <textarea id="sourceText" rows="6">안녕하세요 websocket 재연결을 학습하고 있습니다</textarea>
      </label>

      <div class="row">
        <label class="field">
          <span>Source</span>
          <input id="sourceLanguage" value="ko" />
        </label>
        <label class="field">
          <span>Target</span>
          <input id="targetLanguage" value="en" />
        </label>
      </div>

      <button id="translateButton">번역 시작</button>
      <p id="banner" class="banner">연결 중입니다...</p>
    </section>

    <section class="panel output">
      <div>
        <p class="section-title">스트리밍 번역 결과</p>
        <pre id="translatedText"></pre>
      </div>
      <div>
        <p class="section-title">이벤트 로그</p>
        <pre id="eventLog"></pre>
      </div>
    </section>
  </main>
`;

const style = document.createElement("style");
style.textContent = `
  :root {
    color-scheme: light;
    --bg: #f6f2e8;
    --panel: rgba(255, 252, 246, 0.88);
    --text: #1f1a14;
    --muted: #6c6358;
    --line: rgba(31, 26, 20, 0.12);
    --accent: #be5b2c;
    --accent-strong: #8f3912;
    --shadow: 0 24px 80px rgba(53, 33, 18, 0.08);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "IBM Plex Sans KR", "Pretendard", sans-serif;
    color: var(--text);
    background:
      radial-gradient(circle at top left, rgba(190, 91, 44, 0.18), transparent 28%),
      linear-gradient(135deg, #f3efe6 0%, #f7f2ea 45%, #efe5d1 100%);
    min-height: 100vh;
  }

  .layout {
    width: min(1100px, calc(100% - 32px));
    margin: 32px auto;
    display: grid;
    gap: 20px;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 24px;
    padding: 24px;
    backdrop-filter: blur(12px);
    box-shadow: var(--shadow);
  }

  .hero h1 {
    margin: 8px 0 10px;
    font-family: "Space Grotesk", sans-serif;
    font-size: clamp(2rem, 4vw, 3.6rem);
    line-height: 1;
    letter-spacing: -0.04em;
  }

  .eyebrow, .section-title {
    margin: 0 0 8px;
    color: var(--accent-strong);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.78rem;
  }

  .description {
    margin: 0;
    color: var(--muted);
    max-width: 62ch;
  }

  .status-grid, .row {
    display: grid;
    gap: 12px;
  }

  .status-grid {
    margin-top: 20px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .status-grid article, .field {
    display: grid;
    gap: 8px;
  }

  .status-grid span, .field span {
    color: var(--muted);
    font-size: 0.9rem;
  }

  textarea, input, button, pre {
    font: inherit;
  }

  textarea, input {
    width: 100%;
    border-radius: 16px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.7);
    padding: 14px 16px;
  }

  button {
    border: none;
    border-radius: 999px;
    padding: 14px 20px;
    background: linear-gradient(135deg, var(--accent), #d67d39);
    color: white;
    font-weight: 700;
    cursor: pointer;
    width: fit-content;
  }

  .banner {
    margin: 12px 0 0;
    color: var(--accent-strong);
  }

  .output {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }

  pre {
    min-height: 220px;
    border-radius: 20px;
    background: rgba(31, 26, 20, 0.9);
    color: #f6efe3;
    padding: 16px;
    overflow: auto;
    white-space: pre-wrap;
  }

  @media (max-width: 720px) {
    .layout {
      width: min(100% - 20px, 100%);
      margin: 20px auto;
    }

    .panel {
      padding: 18px;
      border-radius: 20px;
    }
  }
`;
document.head.append(style);

const connectionStatus = must<HTMLSpanElement>("#connectionStatus");
const sessionIdEl = must<HTMLSpanElement>("#sessionId");
const serverInstanceIdEl = must<HTMLSpanElement>("#serverInstanceId");
const sourceTextEl = must<HTMLTextAreaElement>("#sourceText");
const sourceLanguageEl = must<HTMLInputElement>("#sourceLanguage");
const targetLanguageEl = must<HTMLInputElement>("#targetLanguage");
const translatedTextEl = must<HTMLPreElement>("#translatedText");
const eventLogEl = must<HTMLPreElement>("#eventLog");
const bannerEl = must<HTMLParagraphElement>("#banner");
const translateButton = must<HTMLButtonElement>("#translateButton");

const wsUrl = resolveWsUrl();
const sessionStorageKey = "websocket-study-session";
const reconnectBaseMs = 800;
const maxReconnectDelayMs = 4000;

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let heartbeatTimer: number | null = null;
let sessionId = localStorage.getItem(sessionStorageKey) || crypto.randomUUID();
let lastEventId = 0;
let activeRequest: {
  sourceText: string;
  sourceLanguage: string;
  targetLanguage: string;
} | null = null;
let pendingResume = false;

localStorage.setItem(sessionStorageKey, sessionId);
sessionIdEl.textContent = sessionId;

connect();

translateButton.addEventListener("click", () => {
  activeRequest = {
    sourceText: sourceTextEl.value.trim(),
    sourceLanguage: sourceLanguageEl.value.trim(),
    targetLanguage: targetLanguageEl.value.trim(),
  };

  translatedTextEl.textContent = "";
  appendLog(`translate requested: ${JSON.stringify(activeRequest)}`);

  send({
    type: "start_translation",
    payload: {
      sessionId,
      ...activeRequest,
    },
  });
});

function connect() {
  setConnectionState("connecting");
  bannerEl.textContent = "서버와 연결하는 중입니다...";

  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    setConnectionState("connected");
    bannerEl.textContent = "연결되었습니다.";
    startHeartbeat();
    pendingResume = true;

    send({
      type: "hello",
      payload: {
        sessionId,
        lastEventId,
      },
    });
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data) as ServerEvent;
    handleServerEvent(data);
  });

  socket.addEventListener("close", (event) => {
    stopHeartbeat();
    const retryDelay = nextReconnectDelay();
    const drainNotice =
      event.code === WS_CLOSE_SERVER_DRAINING
        ? "배포로 연결이 잠시 바뀌었습니다. 자동 복구 중입니다..."
        : `연결이 끊겼습니다. ${retryDelay}ms 후 재연결합니다.`;

    setConnectionState("reconnecting");
    bannerEl.textContent = drainNotice;
    window.setTimeout(connect, retryDelay);
  });

  socket.addEventListener("error", () => {
    bannerEl.textContent = "WebSocket 오류가 발생했습니다. 자동 복구를 시도합니다.";
  });
}

function handleServerEvent(event: ServerEvent) {
  appendLog(`server: ${JSON.stringify(event)}`);

  switch (event.type) {
    case "welcome":
      sessionId = event.payload.sessionId;
      sessionIdEl.textContent = sessionId;
      serverInstanceIdEl.textContent = event.payload.serverInstanceId;
      localStorage.setItem(sessionStorageKey, sessionId);
      if (pendingResume) {
        if (activeRequest && event.payload.lastEventId === 0 && lastEventId === 0) {
          send({
            type: "start_translation",
            payload: {
              sessionId,
              ...activeRequest,
            },
          });
        } else if (activeRequest) {
          send({
            type: "resume_translation",
            payload: {
              sessionId,
              lastEventId,
            },
          });
          bannerEl.textContent = "기존 번역 스트림을 복구하는 중입니다.";
        }
      }
      pendingResume = false;
      return;

    case "translation_started":
      lastEventId = event.payload.eventId;
      bannerEl.textContent = "번역 스트림이 시작되었습니다.";
      return;

    case "translation_chunk":
      lastEventId = event.payload.eventId;
      translatedTextEl.textContent = event.payload.accumulatedText;
      if (event.payload.done) {
        bannerEl.textContent = "마지막 chunk를 받았습니다.";
      }
      return;

    case "translation_completed":
      lastEventId = event.payload.eventId;
      translatedTextEl.textContent = event.payload.translatedText;
      bannerEl.textContent = "번역이 완료되었습니다.";
      activeRequest = null;
      return;

    case "server_draining":
      bannerEl.textContent = event.payload.reason;
      return;

    case "pong":
      return;

    case "error":
      bannerEl.textContent = event.payload.message;
      return;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    send({
      type: "ping",
      payload: {
        ts: Date.now(),
      },
    });
  }, 5000);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    window.clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function send(event: ClientEvent) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendLog(`send skipped: ${event.type}`);
    return;
  }

  socket.send(JSON.stringify(event));
}

function nextReconnectDelay() {
  reconnectAttempts += 1;
  return Math.min(reconnectBaseMs * reconnectAttempts, maxReconnectDelayMs);
}

function setConnectionState(state: string) {
  connectionStatus.textContent = state;
}

function appendLog(message: string) {
  const now = new Date().toLocaleTimeString();
  eventLogEl.textContent = `[${now}] ${message}\n${eventLogEl.textContent}`.trim();
}

function resolveWsUrl() {
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("ws");
  if (explicit) {
    return explicit;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "localhost";
  return `${protocol}//${host}:8080/ws`;
}

function must<T extends Element>(selector: string) {
  const el = document.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Missing element: ${selector}`);
  }
  return el;
}
