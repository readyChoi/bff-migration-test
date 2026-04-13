// G-1: 장시간 안정성 (Soak Test)
// 30분간 일정 부하 유지, 메모리 누수/GC 패턴 확인
// 사용법:
//   k6 run scenario-g-soak.js
//   k6 run -e DURATION=60m scenario-g-soak.js   # 1시간

import { mockGet, defaultThresholds } from './common.js';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '100'),
      duration: __ENV.DURATION || '30m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000'],
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  mockGet('100ms', '10kb');
}
