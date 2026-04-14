# websocket-study

WebSocket 공부용 레포입니다. `client / server / db`를 한 레포에서 관리하면서, 실시간 번역 스트림과 재배포 시 자동 재연결 흐름을 실습할 수 있게 기본 골격을 잡았습니다.

## 런타임 기준

- Node.js: `24.14.1` LTS 기준
- TypeScript: `6.x` 기준

2026-04-14 기준 공식 릴리스는 Node.js `25.9.0` Current, Node.js `24.14.1` LTS, TypeScript `6.0` 문서가 공개된 상태입니다. 이 레포는 실습/서버 운영 안정성을 위해 최신 Current 대신 최신 LTS인 Node `24.14.1`에 맞췄습니다.

## 구조

```text
apps/
  client/   브라우저 UI, 자동 재연결, heartbeat
  server/   WebSocket 서버, drain 모드, 스트리밍 번역 예제
packages/
  db/       Postgres schema, 상태 영속화 확장 지점
  shared/   client/server 공용 이벤트 타입
```

## 핵심 목표 반영

### 1. websocket 동시 번역 기본 세팅

- 클라이언트가 `start_translation` 이벤트를 보내면
- 서버가 chunk 단위로 `translation_chunk`를 스트리밍합니다.
- 지금은 학습용 mock 번역이지만, 이 자리에 OpenAI/DeepL/NLLB 같은 실제 번역 엔진 호출을 붙이면 됩니다.

### 2. 서버 배포 시 유저가 끊김을 덜 느끼도록 재연결

- 클라이언트는 `sessionId`를 로컬에 저장합니다.
- 서버는 종료 신호를 받으면 `server_draining` 이벤트를 보낸 뒤 연결을 닫습니다.
- 클라이언트는 close code `4010`을 받으면 자동 재연결합니다.
- 진행 중 요청이 있으면 같은 `sessionId`와 요청 본문으로 자동 재요청합니다.

즉, 사용자는 "잠깐 멈췄다가 다시 이어지는" 정도로 느끼고, 별도의 새로고침 없이 흐름을 이어갈 수 있습니다.

## 실행 방법

### 1. 의존성 설치

```bash
nvm use
npm install
```

### 2. 서버 실행

```bash
npm run dev:server
```

### 3. 클라이언트 실행

```bash
npm run dev:client
```

브라우저에서 Vite가 띄운 주소를 열면 됩니다. 기본적으로 클라이언트는 `ws://localhost:8080/ws`에 연결합니다.

## DB 실행

Postgres 로컬 테스트용 compose 파일을 넣어두었습니다.

```bash
docker compose up -d
```

현재 서버는 메모리 저장소를 쓰고 있고, `packages/db/schema.sql`은 실제 배포용 복구 구조를 준비하는 출발점입니다.

## 배포 전략 메모

학습용 예제는 "재연결 전략"에 초점을 맞췄고, 진짜 무중단에 가깝게 가려면 상태를 외부 저장소로 빼야 합니다.

### 지금 예제에서 되는 것

- 서버 재시작 감지
- 클라이언트 자동 재연결
- 같은 세션으로 재요청
- 유저가 수동 새로고침하지 않아도 복구

### 운영 환경에서 추가할 것

1. 번역 job 상태를 DB 또는 Redis에 저장
2. chunk 이벤트를 append-only 로 저장
3. 새 서버 인스턴스가 이전 세션을 이어받도록 복구
4. 로드밸런서에서 drain 동안 새 연결만 다른 인스턴스로 보냄
5. readiness probe가 `draining` 상태를 반영하도록 구성

## 다음 확장 추천

1. `packages/db`에 Prisma 또는 Drizzle 추가
2. Redis pub/sub 로 여러 서버 인스턴스 간 세션 공유
3. 실제 STT -> 번역 -> TTS 파이프라인 연결
4. 인증 토큰과 사용자별 세션 분리
