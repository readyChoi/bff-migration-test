# Mock Downstream 서비스

BFF 성능 테스트용 configurable echo 서비스. BFF 라우트 테이블에 `/mock` → `mock-downstream` 경로를 추가하고, k6가 `/mock/delay/{값}/size/{값}` 형태로 호출한다.

## 테스트 구조

```
k6 ──→ BFF Pod ──(/mock/*)-→ mock-downstream Pod
```

- BFF 소스코드 변경 없음 (라우트 테이블만 추가)
- BFF의 요청 처리 파이프라인(인증 filter, thread pool 등)을 그대로 거침
- mock 응답 특성은 URL path 파라미터로 제어

## 빌드 & 배포

```bash
docker build -t your-registry/mock-downstream:v1 .
docker push your-registry/mock-downstream:v1
oc apply -f deployment.yaml -n test
oc apply -f service.yaml    -n test
```

OKD 환경 배포의 결정 근거·SCC·GOMAXPROCS·QoS 등 상세 설명은 [[OKD-배포가이드]] 참고.

배포 후 BFF 라우트 테이블에 추가:

```
/mock/** → mock-downstream.test.svc:8080
```

---

## API

### `* /delay/{val}/size/{val}/error/{val}` — path 파라미터 (기본 사용법)

URL path에 값을 넣으면 사전 설정 없이 바로 동작한다. **대부분의 시나리오에서 이것만 사용.**

```bash
# k6 → BFF → mock: 2초 지연, 1MB 응답
curl http://bff/mock/delay/2s/size/1mb

# 100ms 지연, 10KB 응답
curl http://bff/mock/delay/100ms/size/10kb

# 500ms 지연, 50% 에러
curl http://bff/mock/delay/500ms/size/100kb/error/50

# 지연만
curl http://bff/mock/delay/1s

# 크기만
curl http://bff/mock/size/500kb
```

| 키 | 값 예시 | 설명 |
|----|--------|------|
| `delay` | `100ms`, `2s`, `1m` | 응답 지연 (Go duration) |
| `size` | `1kb`, `100kb`, `1mb` | 응답 body 크기 |
| `error` | `50`, `100` | 에러 확률 (0~100, error code 기본 500) |
| `errorcode` | `503`, `429` | 에러 시 HTTP status (error와 함께 사용) |

> path 파라미터가 있으면 routes/global config보다 **우선 적용**

### `GET /health`

```
HTTP/1.1 200 OK
{"status":"healthy"}
```

### `PUT /config` — 전역 설정

path 파라미터가 없는 요청에 적용. F-3 schedule과 함께 사용.

```bash
curl -X PUT http://mock-downstream:8080/config \
  -d '{"delay":"500ms","error_rate":10,"error_code":503,"payload_size":10240}'
```

### `PUT /config/routes` — path prefix별 설정

path 파라미터 방식의 대안. 고정 config를 미리 설정해두고 싶을 때.

```bash
curl -X PUT http://mock-downstream:8080/config/routes \
  -d '{
    "/slow":    {"delay":"1s",   "payload_size":1048576},
    "/fast":    {"delay":"100ms","payload_size":10240},
    "_default": {"delay":"100ms","payload_size":1024}
  }'
```

### `PUT /config/schedule` — 시간에 따라 자동 전환

F-3(정상→장애→복구) 시나리오용. path 파라미터 없이 호출해야 적용됨.

```bash
curl -X PUT http://mock-downstream:8080/config/schedule \
  -d '{
    "phases": [
      {"at":"0s",   "config":{"delay":"100ms","error_rate":0,"payload_size":1024}},
      {"at":"120s", "config":{"delay":"100ms","error_rate":100,"error_code":500}},
      {"at":"240s", "config":{"delay":"100ms","error_rate":0,"payload_size":1024}}
    ]
  }'
```

취소: `curl -X DELETE http://mock-downstream:8080/config/schedule`

### `GET /metrics`

```json
{"total_requests":15230,"success_count":14500,"error_count":730,"active_requests":42}
```

### `POST /reset`

설정, 스케줄, 카운터 모두 초기화.

---

## Config 필드

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `delay` | string | `""` (0) | 응답 전 대기 |
| `error_rate` | int | `0` | 에러 확률 (0~100) |
| `error_code` | int | `500` | 에러 시 HTTP status |
| `payload_size` | int | `0` | 응답 body 크기 (bytes) |
| `fail_after` | int | `0` | N번째 요청 이후 무조건 에러 |
| `response_body` | string | `""` | 커스텀 응답 JSON |
| `read_body` | bool | `false` | request body를 끝까지 읽을지 |

---

## 응답 흐름

```
요청 수신
  │
  ├─ path 파라미터 파싱 (/delay/2s/size/1mb) → 있으면 바로 사용
  │   없으면 ↓
  ├─ path prefix routes 매칭 → 있으면 사용
  │   없으면 ↓
  ├─ 전역 config 사용
  │
  ├─ read_body → delay → fail_after → error_rate 순서로 처리
  │
  └─ 정상 응답 (response_body 또는 payload_size 또는 기본 JSON)
```

---

## k6 사용 예시

### 환경변수로 시나리오 전환 (가장 일반적)

```bash
k6 run -e DELAY=100ms -e SIZE=1kb  scenario.js   # A-2
k6 run -e DELAY=2s    -e SIZE=1mb  scenario.js   # 느리고 무거운
k6 run -e VUS=1000    -e DELAY=100ms scenario.js  # 고동시성
```

```javascript
const BFF = __ENV.BFF_HOST || 'http://bff.test.svc';
const DELAY = __ENV.DELAY || '100ms';
const SIZE = __ENV.SIZE || '1kb';

export default function () {
  http.get(`${BFF}/mock/delay/${DELAY}/size/${SIZE}`);
}
```

### 혼합 부하

```javascript
export const options = {
  scenarios: {
    fast:  { executor: 'constant-vus', vus: 150, duration: '5m', exec: 'callFast' },
    slow:  { executor: 'constant-vus', vus: 50,  duration: '5m', exec: 'callSlow' },
  },
};

export function callFast() {
  http.get(`${BFF}/mock/delay/100ms/size/1kb`);
}
export function callSlow() {
  http.get(`${BFF}/mock/delay/2s/size/1mb`);
}
```

### F-3 (CB lifecycle)

```bash
# 1. schedule 설정
curl -X PUT http://mock-downstream:8080/config/schedule -d '{...}'

# 2. path 파라미터 없이 호출 → global config/schedule 적용
k6 run --vus 300 --duration 6m scenario-f3.js
```

```javascript
// scenario-f3.js
export default function () {
  http.get(`${BFF}/mock/api/test`);  // path 파라미터 없음 → schedule 적용
}
```
