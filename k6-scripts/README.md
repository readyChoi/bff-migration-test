# k6 테스트 스크립트

## 파일 목록

| 파일 | 시나리오 | 설명 |
|------|---------|------|
| `common.js` | - | 공통 헬퍼, 환경변수, custom metrics |
| `scenario-a-latency.js` | A-1~A-4 | downstream latency 변화 (10ms ~ 2s) |
| `scenario-b-response-size.js` | B-1~B-4 | response body 크기 변화 (1KB ~ 1MB) |
| `scenario-c-request-size.js` | C-1~C-4 | request body 크기 변화 (500B ~ 500KB) |
| `scenario-e-concurrency.js` | E-1~E-4 | 고동시성 ramping (500 ~ 1000 VU) |
| `scenario-f2-cb-timeout.js` | F-2 | CB timeout 유도 |
| `scenario-f3-cb-lifecycle.js` | F-3 | CB 정상→장애→복구 lifecycle (6분) |
| `scenario-g-soak.js` | G-1 | 장시간 안정성 (30분) |
| `scenario-mixed.js` | 혼합 | 여러 특성의 요청 동시 실행 |
| `scenario-h-memory-leak.js` | H-1 | Hystrix 메모리 누적 관찰 (4 Phase, 기본 2시간) |
| `scenario-h2-key-growth.js` | H-2 | Command Key 증가에 따른 힙 증가 (5 Phase, 100→10,000 keys) |
| `monitor-heap.sh` | - | BFF pod 힙/GC/스레드 주기적 기록 (CSV 출력) |

## 빠른 실행

```bash
# A 시리즈 (latency 변화)
k6 run -e DELAY=10ms  scenario-a-latency.js
k6 run -e DELAY=100ms scenario-a-latency.js
k6 run -e DELAY=500ms scenario-a-latency.js
k6 run -e DELAY=2s    scenario-a-latency.js

# B 시리즈 (response 크기 변화)
k6 run -e SIZE=1kb  scenario-b-response-size.js
k6 run -e SIZE=10kb scenario-b-response-size.js
k6 run -e SIZE=100kb scenario-b-response-size.js
k6 run -e SIZE=1mb  scenario-b-response-size.js

# C 시리즈 (request 크기 변화)
k6 run -e REQ_SIZE=500b  scenario-c-request-size.js
k6 run -e REQ_SIZE=50kb  scenario-c-request-size.js

# E 시리즈 (고동시성)
k6 run scenario-e-concurrency.js                  # E-1 (500 VU)
k6 run -e MAX_VUS=1000 scenario-e-concurrency.js  # E-2 (1000 VU)
k6 run -e DELAY=500ms -e SIZE=100kb scenario-e-concurrency.js  # E-3

# F 시리즈 (Circuit Breaker)
k6 run scenario-f2-cb-timeout.js
k6 run -e AUTO_SCHEDULE=true scenario-f3-cb-lifecycle.js

# G 시리즈 (Soak)
k6 run scenario-g-soak.js
k6 run -e DURATION=60m scenario-g-soak.js  # 1시간

# 혼합 부하
k6 run scenario-mixed.js
k6 run -e FAST_VUS=200 -e SLOW_VUS=100 scenario-mixed.js

# H 시리즈 (Hystrix 메모리 누적 — 힙 모니터링 병행)
chmod +x monitor-heap.sh
./monitor-heap.sh 30 7200 &                          # 30초 간격, 2시간
k6 run scenario-h-memory-leak.js                      # 기본 2시간
k6 run -e DURATION_MINUTES=180 scenario-h-memory-leak.js  # 3시간

# H-2 (Command Key 증가)
./monitor-heap.sh 15 6000 &
k6 run scenario-h2-key-growth.js                            # 기본 10,000 keys
k6 run -e MAX_KEYS=20000 scenario-h2-key-growth.js          # 20,000 keys
```

## 공통 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BFF_HOST` | `http://bff.test.svc` | BFF 주소 |
| `MOCK_HOST` | `http://mock-downstream.test.svc` | mock 직접 접근 주소 (config/reset용) |
| `DELAY` | `100ms` | downstream 지연 |
| `SIZE` | `1kb` | response body 크기 |
| `VUS` | `200` | VU 수 (constant-vus용) |
| `MAX_VUS` | `500` | 최대 VU 수 (ramping-vus용) |
| `DURATION` | `5m` | 테스트 시간 |
| `REQ_SIZE` | `500b` | request body 크기 (C 시리즈) |

## 결과 저장

```bash
# JSON
k6 run --out json=results/a1.json scenario-a-latency.js

# Prometheus
k6 run --out experimental-prometheus-rw \
  --env K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write \
  scenario-a-latency.js
```

## 전체 시나리오 일괄 실행 (예시)

```bash
#!/bin/bash
RESULTS="./results/$(date +%Y%m%d-%H%M)"
mkdir -p $RESULTS

echo "=== A 시리즈 ==="
for DELAY in 10ms 100ms 500ms 2s; do
  echo "A: delay=$DELAY"
  curl -s -X POST http://mock-downstream.test.svc:8080/reset
  k6 run -e DELAY=$DELAY --out json=$RESULTS/a-$DELAY.json scenario-a-latency.js
done

echo "=== B 시리즈 ==="
for SIZE in 1kb 10kb 100kb 1mb; do
  echo "B: size=$SIZE"
  curl -s -X POST http://mock-downstream.test.svc:8080/reset
  k6 run -e SIZE=$SIZE --out json=$RESULTS/b-$SIZE.json scenario-b-response-size.js
done

echo "=== E 시리즈 ==="
for VUS in 500 1000; do
  echo "E: vus=$VUS"
  curl -s -X POST http://mock-downstream.test.svc:8080/reset
  k6 run -e MAX_VUS=$VUS --out json=$RESULTS/e-$VUS.json scenario-e-concurrency.js
done

echo "=== Mixed ==="
curl -s -X POST http://mock-downstream.test.svc:8080/reset
k6 run --out json=$RESULTS/mixed.json scenario-mixed.js

echo "=== G Soak ==="
curl -s -X POST http://mock-downstream.test.svc:8080/reset
k6 run --out json=$RESULTS/soak.json scenario-g-soak.js
```
