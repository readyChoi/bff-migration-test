# TODO

## Phase 0: 현행 분석

### 트래픽

| # | 조사 항목 | 방법 | 결과 |
|---|----------|------|------|
| 0-1 | 일일 RPS (피크/평균) | Prometheus, access log | |
| 0-2 | 기능별 API 호출 비율 | access log, Istio telemetry | |
| 0-3 | 피크 시간대 | Grafana | |
| 0-4 | 동시 접속자 수 (피크) | 세션 수 / 커넥션 수 | |

### Request/Response 크기

| # | 조사 항목 | 방법 | 결과 |
|---|----------|------|------|
| 0-5 | API별 request body 크기 (p50/p95/max) | access log, Istio metrics | |
| 0-6 | API별 response body 크기 (p50/p95/max) | access log, Istio metrics | |
| 0-7 | request header 평균 크기 | 샘플 캡처 (JWT 토큰 포함 시 커짐) | |

### BFF 설정

| # | 조사 항목 | 방법 | 결과 |
|---|----------|------|------|
| 0-8 | thread pool 설정 (tomcat max-threads) | application.yml | |
| 0-9 | Hystrix thread pool 설정 | application.yml | |
| 0-10 | JVM 옵션 (GC, heap size) | Dockerfile, deployment | |
| 0-11 | Pod 리소스 스펙 (CPU/Memory) | k8s deployment | |
| 0-12 | Spring Boot 버전 | pom.xml / build.gradle | |

### 현재 성능 기준선

| # | 조사 항목 | 방법 | 결과 |
|---|----------|------|------|
| 0-13 | 운영 평균/p95/p99 응답시간 | Prometheus | |
| 0-14 | Pod CPU/Memory 사용량 | Prometheus, cAdvisor | |
| 0-15 | GC 빈도/pause 시간 | JMX, Prometheus | |
| 0-16 | 활성 스레드 수 (평균/피크) | JMX, Prometheus | |

---

## Phase 1: 테스트 환경 구축

| # | 작업 | 상세 | 상태 |
|---|------|------|------|
| 1-1 | test namespace 생성 | Istio injection 활성화 | |
| 1-2 | BFF 이미지 A: Java 8 + Hystrix | 운영과 동일 설정 | |
| 1-3 | BFF 이미지 B: Java 25 + VT + R4j | 최종 목표 구성 | |
| 1-4 | BFF 라우트 테이블에 `/mock` 경로 추가 | `/mock` → mock-downstream | |
| 1-5 | mock-downstream 빌드 & 배포 | `mock-downstream/` 참조 | |
| 1-6 | k6 실행 환경 준비 | 클러스터 내/외부 결정 | |
| 1-7 | Prometheus + Grafana 연동 확인 | BFF metrics, k6 remote write | |
| 1-8 | 테스트 결과 저장소 준비 | JFR, k6 JSON 보관 위치 | |

---

## Phase 2: 테스트 실행

| # | 작업 | 상세 | 상태 |
|---|------|------|------|
| 2-1 | 이미지 A 측정 | 모든 시나리오, 각 3회 반복 | |
| 2-2 | 이미지 B 측정 | 동일 시나리오, 각 3회 반복 | |
| 2-3 | CB 기능 검증 | [[05-CB-마이그레이션]] 검증 항목 | |
| 2-4 | CB 성능 테스트 | CB-1 ~ CB-4 | |
| 2-5 | Soak Test (G-1) | 30분 장시간 안정성 | |

---

## Phase 3: 분석 & 정리

| # | 작업 | 상세 | 상태 |
|---|------|------|------|
| 3-1 | 비교 결과 표 작성 | [[06-메트릭-및-판단기준]] 템플릿 사용 | |
| 3-2 | JFR 분석 | flame graph, GC, thread | |
| 3-3 | 병목 구간 식별 | Java 8 병목이 25에서 해소되었는지 | |
| 3-4 | 리소스 효율성 비교 | 동일 성능 대비 CPU/Memory 차이 | |
| 3-5 | 최종 보고서 | 결론, 권장사항, 리스크 | |
| 3-6 | Pod 스펙 조정 제안 | VT 도입 시 리소스 limit 재산정 | |
