// E 시리즈: 고동시성
// 사용법:
//   k6 run scenario-e-concurrency.js                        # E-1 (500 VU)
//   k6 run -e MAX_VUS=1000 scenario-e-concurrency.js        # E-2 (1000 VU)
//   k6 run -e DELAY=500ms -e SIZE=100kb scenario-e-concurrency.js  # E-3
//
// ramping-vus executor로 단계적으로 올림

import { mockGet, DELAY, SIZE, defaultThresholds } from './common.js';

const maxVUs = parseInt(__ENV.MAX_VUS || '500');
const delay = __ENV.DELAY || '100ms';
const size = __ENV.SIZE || '10kb';

export const options = {
  scenarios: {
    concurrency_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: Math.floor(maxVUs * 0.2) },    // 20%
        { duration: '2m', target: Math.floor(maxVUs * 0.2) },    // steady
        { duration: '1m', target: Math.floor(maxVUs * 0.5) },    // 50%
        { duration: '2m', target: Math.floor(maxVUs * 0.5) },    // steady
        { duration: '1m', target: maxVUs },                       // 100%
        { duration: '3m', target: maxVUs },                       // steady at peak
        { duration: '2m', target: 0 },                            // ramp-down
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  mockGet(delay, size);
}
