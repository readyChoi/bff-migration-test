// B 시리즈: response body 크기 변화
// 사용법:
//   k6 run -e SIZE=1kb   scenario-b-response-size.js   # B-1
//   k6 run -e SIZE=10kb  scenario-b-response-size.js   # B-2
//   k6 run -e SIZE=100kb scenario-b-response-size.js   # B-3
//   k6 run -e SIZE=1mb   scenario-b-response-size.js   # B-4

import { mockGet, SIZE, defaultThresholds } from './common.js';

export const options = {
  scenarios: {
    size_test: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '200'),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: defaultThresholds,
};

export default function () {
  mockGet('100ms', SIZE);
}
