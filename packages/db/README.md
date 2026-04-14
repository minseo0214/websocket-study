# DB package

이 패키지는 websocket 세션, 번역 요청, 재연결 복구용 상태를 Postgres에 저장하는 저장소 계층입니다.

현재 포함된 내용:

1. `translation_jobs` 영속 상태 저장
2. `translation_events` append-only 이벤트 로그
3. `sessionId + lastEventId` 기반 resume 복구

기본 연결 문자열:

```bash
postgres://websocket:websocket@localhost:5432/websocket_study
```

환경변수 `DATABASE_URL`로 덮어쓸 수 있습니다.

다음 확장 추천:

1. Redis 캐시와 pub/sub 추가
2. 번역 엔진 호출 상태와 에러 코드 저장
3. 분산 락 또는 job ownership 컬럼 추가
