# DB package

이 패키지는 websocket 세션, 번역 요청, 재연결 복구용 상태를 외부 저장소로 옮길 때 기준이 되는 자리입니다.

추천 확장 순서:

1. `translation_jobs`에 요청 본문과 상태를 저장
2. `translation_events`에 chunk 단위 이벤트를 append-only 로 저장
3. 서버 재배포 시에도 `sessionId` 기준으로 복구
4. 여러 서버 인스턴스 사이에서 세션 공유가 필요하면 Redis pub/sub 또는 stream 추가
