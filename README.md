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
- 서버는 `translation_jobs`, `translation_events`를 Postgres에 저장합니다.
- 서버는 종료 신호를 받으면 `server_draining` 이벤트를 보낸 뒤 연결을 닫습니다.
- 클라이언트는 close code `4010`을 받으면 자동 재연결합니다.
- 재연결 후 클라이언트는 `resume_translation`을 보내고, 서버는 `lastEventId` 이후 이벤트만 재전송합니다.

즉, 사용자는 "잠깐 멈췄다가 다시 이어지는" 정도로 느끼고, 별도의 새로고침 없이 흐름을 이어갈 수 있습니다.

## 실행 방법

### 1. 의존성 설치

```bash
nvm use
npm install
```

### 2. 서버 실행

```bash
nvm use
npm run dev:server
```

### 3. 클라이언트 실행

```bash
nvm use
npm run dev:client
```

브라우저에서 Vite가 띄운 주소를 열면 됩니다. 기본적으로 클라이언트는 `ws://localhost:8080/ws`에 연결합니다.

## DB 실행

Postgres 로컬 테스트용 compose 파일을 넣어두었습니다.

```bash
docker compose up -d
```

현재 서버는 Postgres를 상태 원본으로 사용합니다. 기본 연결 문자열은 아래와 같습니다.

```bash
postgres://websocket:websocket@localhost:5432/websocket_study
```

필요하면 `DATABASE_URL`로 바꿀 수 있습니다.

## 배포 전략 메모

이 예제는 `Postgres 기반 resume`까지 포함한 단계입니다. Kubernetes 운영형으로 갈 때는 여기에 Redis, readiness, drain orchestration을 추가하는 방식으로 확장하면 됩니다.

### 지금 예제에서 되는 것

- 서버 재시작 감지
- 클라이언트 자동 재연결
- 같은 세션으로 resume
- `lastEventId` 이후 이벤트 재전송
- Postgres 기반 상태 복구
- 유저가 수동 새로고침하지 않아도 복구

### 운영 환경에서 추가할 것

1. Redis로 현재 진행 상태와 pub/sub 추가
2. 새 서버 인스턴스 간 중복 실행 방지를 위한 분산 락 또는 ownership 추가
3. 로드밸런서에서 drain 동안 새 연결만 다른 인스턴스로 보냄
4. readiness probe가 `draining` 상태를 반영하도록 구성
5. 실제 번역 엔진 호출 결과를 durable queue와 연결

## 재연결 테스트

1. `docker compose up -d`
2. `npm run dev:server`
3. `npm run dev:client`
4. 브라우저에서 긴 문장으로 번역 시작
5. chunk가 오는 중에 서버를 종료
6. 다시 서버 실행
7. 클라이언트가 자동 재연결 후 `resume_translation`으로 이어받는지 확인

확인 포인트:

- 세션 ID가 유지되는지
- 서버 인스턴스 ID는 바뀌었지만 작업이 이어지는지
- 이미 받은 chunk 이후부터만 이벤트가 오는지
- 완료 후 중복 chunk 없이 `translation_completed`가 오는지

## 다음 확장 추천

1. Redis pub/sub 로 여러 서버 인스턴스 간 세션 공유
2. job ownership 또는 advisory lock 으로 중복 실행 방지
3. 실제 STT -> 번역 -> TTS 파이프라인 연결
4. 인증 토큰과 사용자별 세션 분리
