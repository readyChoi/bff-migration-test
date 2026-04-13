// F-2: CB timeout 유도
// downstream 응답이 CB timeout보다 길면 CB OPEN 전환
// 사용법:
//   k6 run scenario-f2-cb-timeout.js
//   k6 run -e DELAY=3s scenario-f2-cb-timeout.js   # timeout 값에 맞게 조절

import { check } from 'k6';
import { mockGet, mockLatency, defaultThresholds } from './common.js';

const delay = __ENV.DELAY || '2s';

export const options = {
  scenarios: {
    cb_timeout: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '300'),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: {
    // CB가 OPEN되면 latency가 급감해야 함 (fallback 즉시 반환)
    http_req_duration: ['p(50)<3000'],
  },
};

export default function () {
  const res = mockGet(delay, '1kb');
  // CB OPEN 후 fallback 반환 시 latency가 100ms 이하로 떨어지는지 관찰
  check(res, {
    'response received': (r) => r.status === 200 || r.status === 503 || r.status === 504,
  });
}
