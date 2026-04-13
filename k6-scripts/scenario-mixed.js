// 혼합 부하: 여러 특성의 요청을 동시에 BFF에 전송
// 운영 트래픽 패턴을 근사하게 재현
//
// 사용법:
//   k6 run scenario-mixed.js
//
// VU 비율 커스텀:
//   k6 run -e FAST_VUS=200 -e SLOW_VUS=50 -e LARGE_VUS=30 -e ERROR_VUS=20 scenario-mixed.js

import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';
import { BFF } from './common.js';

const fastLatency = new Trend('fast_small_latency', true);
const slowLatency = new Trend('slow_large_latency', true);
const largeRespLatency = new Trend('large_resp_latency', true);
const errorLatency = new Trend('error_scenario_latency', true);

const duration = __ENV.DURATION || '5m';

export const options = {
  scenarios: {
    // 가볍고 빠른 요청 (일반적인 API 조회)
    fast_small: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.FAST_VUS || '150'),
      duration: duration,
      exec: 'callFastSmall',
    },
    // 느리고 무거운 요청 (복잡한 조회)
    slow_large: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.SLOW_VUS || '50'),
      duration: duration,
      exec: 'callSlowLarge',
    },
    // 대용량 응답 (리스트 API)
    large_response: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.LARGE_VUS || '30'),
      duration: duration,
      exec: 'callLargeResponse',
    },
    // 간헐적 에러 (장애 상황 시뮬레이션)
    error_scenario: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.ERROR_VUS || '20'),
      duration: duration,
      exec: 'callError',
    },
  },
  thresholds: {
    fast_small_latency: ['p(95)<500'],
    slow_large_latency: ['p(95)<5000'],
    http_req_failed: ['rate<0.15'],
  },
};

export function callFastSmall() {
  const res = http.get(`${BFF}/mock/delay/100ms/size/1kb`);
  fastLatency.add(res.timings.duration);
  check(res, { 'fast: 200': (r) => r.status === 200 });
}

export function callSlowLarge() {
  const res = http.get(`${BFF}/mock/delay/1s/size/100kb`);
  slowLatency.add(res.timings.duration);
  check(res, { 'slow: 200': (r) => r.status === 200 });
}

export function callLargeResponse() {
  const res = http.get(`${BFF}/mock/delay/200ms/size/1mb`);
  largeRespLatency.add(res.timings.duration);
  check(res, { 'large: 200': (r) => r.status === 200 });
}

export function callError() {
  const res = http.get(`${BFF}/mock/delay/100ms/size/1kb/error/30`);
  errorLatency.add(res.timings.duration);
  // 에러 시나리오이므로 200 또는 500 모두 허용
  check(res, { 'error: got response': (r) => r.status > 0 });
}
