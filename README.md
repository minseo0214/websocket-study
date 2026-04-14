# websocket-study

WebSocket 공부용 레포 🔌

Node.js + `ws` 라이브러리를 사용한 WebSocket 서버와 브라우저 클라이언트 예제입니다.

---

## 기능

| 기능 | 설명 |
|------|------|
| **브로드캐스트 채팅** | 접속한 모든 클라이언트에게 메시지 전송 |
| **에코(Echo)** | 서버가 메시지를 보낸 클라이언트에게만 그대로 돌려줌 |
| **접속자 알림** | 사용자 입장/퇴장 시 모든 클라이언트에게 시스템 메시지 전송 |
| **자동 재연결** | 연결이 끊기면 3초 후 자동 재연결 시도 |

---

## 프로젝트 구조

```
websocket-study/
├── server.js          # WebSocket + HTTP 서버
├── public/
│   └── index.html     # 브라우저 클라이언트 (채팅 UI)
├── package.json
└── README.md
```

---

## 시작하기

### 1. 의존성 설치

```bash
npm install
```

### 2. 서버 실행

```bash
npm start
```

서버가 실행되면 아래와 같이 출력됩니다:

```
서버 실행 중: http://localhost:8080
WebSocket 주소:  ws://localhost:8080
```

### 3. 브라우저에서 접속

브라우저를 열고 <http://localhost:8080> 으로 이동합니다.  
탭을 여러 개 열면 멀티 클라이언트 채팅을 체험할 수 있습니다.

---

## 환경 변수

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `PORT` | `8080` | 서버 포트 |

```bash
PORT=3000 npm start
```

---

## WebSocket 메시지 프로토콜

모든 메시지는 JSON 형식입니다.

### 클라이언트 → 서버

```json
// 채팅 (브로드캐스트)
{ "type": "chat", "sender": "닉네임", "message": "안녕하세요!" }

// 에코 (본인에게만 응답)
{ "type": "echo", "message": "에코 테스트" }
```

### 서버 → 클라이언트

```json
// 채팅 메시지
{ "type": "chat", "sender": "닉네임", "message": "안녕하세요!" }

// 에코 응답
{ "type": "echo", "message": "에코 테스트" }

// 시스템 메시지
{ "type": "system", "message": "새 사용자가 입장했습니다. (접속자: 2명)" }
```
