// A 시리즈: downstream latency 변화
// 사용법:
//   k6 run -e DELAY=10ms  scenario-a-latency.js   # A-1
//   k6 run -e DELAY=100ms scenario-a-latency.js   # A-2
//   k6 run -e DELAY=500ms scenario-a-latency.js   # A-3
//   k6 run -e DELAY=2s    scenario-a-latency.js   # A-4
//
// 옵션:
//   -e VUS=200 (기본), -e DURATION=5m (기본)

import { mockGet, BFF, DELAY, defaultThresholds } from './common.js';

export const options = {
  scenarios: {
    latency_test: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '200'),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: defaultThresholds,
};

export default function () {
  mockGet(DELAY, '1kb');
}
