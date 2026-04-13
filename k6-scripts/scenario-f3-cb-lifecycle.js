// F-3: CB 전체 lifecycle (정상 → 장애 → 복구)
//
// 사전 설정 필요:
//   curl -X PUT http://mock-downstream.test.svc:8080/config/schedule -d '{
//     "phases": [
//       {"at":"0s",   "config":{"delay":"100ms","error_rate":0,"payload_size":1024}},
//       {"at":"120s", "config":{"delay":"100ms","error_rate":100,"error_code":500}},
//       {"at":"240s", "config":{"delay":"100ms","error_rate":0,"payload_size":1024}}
//     ]
//   }'
//
// 사용법:
//   k6 run scenario-f3-cb-lifecycle.js
//
// 또는 setup()에서 자동 설정:
//   k6 run -e AUTO_SCHEDULE=true scenario-f3-cb-lifecycle.js

import { check } from 'k6';
import { mockRaw, scheduleMock, resetMock, defaultThresholds } from './common.js';

export const options = {
  scenarios: {
    cb_lifecycle: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '300'),
      duration: '6m',
    },
  },
};

export function setup() {
  if (__ENV.AUTO_SCHEDULE === 'true') {
    resetMock();
    scheduleMock([
      { at: '0s',   config: { delay: '100ms', error_rate: 0, payload_size: 1024 } },
      { at: '120s', config: { delay: '100ms', error_rate: 100, error_code: 500 } },
      { at: '240s', config: { delay: '100ms', error_rate: 0, payload_size: 1024 } },
    ]);
  }
}

export default function () {
  // path 파라미터 없이 호출 → global config/schedule 적용
  const res = mockRaw('/api/test');
  check(res, {
    'got response': (r) => r.status === 200 || r.status === 500 || r.status === 503,
  });
}

export function teardown() {
  resetMock();
}
