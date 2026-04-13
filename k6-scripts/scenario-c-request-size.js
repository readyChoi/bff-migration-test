// C 시리즈: request body 크기 변화
// 사용법:
//   k6 run -e REQ_SIZE=500b  scenario-c-request-size.js   # C-1
//   k6 run -e REQ_SIZE=5kb   scenario-c-request-size.js   # C-2
//   k6 run -e REQ_SIZE=50kb  scenario-c-request-size.js   # C-3
//   k6 run -e REQ_SIZE=500kb scenario-c-request-size.js   # C-4

import { mockPost, PAYLOADS, defaultThresholds } from './common.js';

export const options = {
  scenarios: {
    request_size_test: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '200'),
      duration: __ENV.DURATION || '5m',
    },
  },
  thresholds: defaultThresholds,
};

const reqSize = __ENV.REQ_SIZE || '500b';
const body = PAYLOADS[reqSize] || PAYLOADS['500b'];

export default function () {
  mockPost('100ms', '1kb', body);
}
