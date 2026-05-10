# BFF Java 8 → 25 Virtual Thread 성능 테스트 계획

> MSA 환경의 BFF 서비스를 Java 8에서 25로 업그레이드하고, Virtual Thread 도입 + Hystrix→Resilience4j 전환의 성능/리소스 개선 효과를 검증하기 위한 테스트 계획

## 문서 목록

| # | 문서 | 설명 |
|---|------|------|
| 1 | [[01-테스트-전략]] | A/B 비교 구조, 테스트 방식, 테스트 범위 |
| 2 | [[02-도구-선정]] | 부하/모니터링/프로파일링 도구 비교 및 최종 추천 |
| 3 | [[03-시나리오]] | 시나리오 매트릭스 + 실행 방법 + k6 스크립트 |
| 4 | [[04-k6-가이드]] | k6 핵심 개념, executor, 여러 URL 동시 호출, 결과 출력 |
| 5 | [[05-CB-마이그레이션]] | Hystrix → Resilience4j 기능 검증 및 성능 시나리오 |
| 6 | [[06-메트릭-및-판단기준]] | 수집 메트릭, 비교 결과 템플릿, 성공 판단 기준 |
| 7 | [[07-TODO]] | Phase 0~3 체크리스트 |
| 8 | [[08-추후-고려-사항]] | BFF 내부 기능 테스트, Chaos Mesh |
| 9 | [[09-Java-25-변경사항]] | VT 외 성능에 영향 주는 Java 8→25 변경점 (G1 개선, Compact Strings, JIT 등) |
| 10 | [[10-JVM-옵션-비교]] | Java 8→25 JVM 옵션 변경점, 추천 설정, 제거된 옵션, 튜닝 후보 |
| - | [[99-QnA]] | 궁금한 점 모음 |

## 코드 / 배포

| 디렉토리 | 내용 |
|----------|------|
| `mock-downstream/` | Go Mock 서비스 (main.go, Dockerfile, k8s.yaml, k6-helpers.js) |
| `k6-scripts/` | k6 테스트 스크립트 (시나리오 A~G, mixed, 일괄 실행) |
| `k8s/` | [[k8s/k6-operator-운영가이드]], k6-operator-values.yaml (OKD), TestRun 예시 |

## 배경

- **현재**: Java 8, Hystrix, Spring Boot (MSA 환경, Istio)
- **목표**: Java 25 + Virtual Thread, Resilience4j
- **검증**: throughput, latency, 리소스(CPU, Memory, Thread count) 개선 여부
