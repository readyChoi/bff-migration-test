// H-2: Command Key 증가에 따른 메모리 누적 관찰
//
// 목적: Hystrix가 command key별로 metrics를 영구 보관하면서
//       key 수가 늘어날수록 힙이 계속 증가하는지 관찰.
//       R4j에서는 key당 메모리가 작아 증가 폭이 작을 것으로 예상.
//
// 동작: 시간이 지날수록 unique path(= command key)를 점점 늘림
//   Phase 1: key 100개 (워밍업, baseline)
//   Phase 2: key 1,000개
//   Phase 3: key 5,000개
//   Phase 4: key 10,000개
//   Phase 5: 새 key 생성 중단, 기존 key만 호출 (힙 안정화 여부)
//
// 사용법:
//   ./monitor-heap.sh 15 7200 &
//   k6 run scenario-h2-key-growth.js
//   k6 run -e MAX_KEYS=20000 scenario-h2-key-growth.js
//
// 주의: BFF가 요청 path를 command key로 사용하는 경우에만 유효

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Gauge, Trend } from 'k6/metrics';
import { BFF } from './common.js';

const maxKeys = parseInt(__ENV.MAX_KEYS || '10000');
const phaseDuration = __ENV.PHASE_DURATION || '20m';

const uniqueKeys = new Gauge('unique_keys_created');
const responseTime = new Trend('h2_response_time', true);
const keyErrors = new Counter('key_test_errors');

// 각 Phase에서 사용할 key 범위
// Phase 1: 0 ~ 99 (100개)
// Phase 2: 0 ~ 999 (1,000개)
// Phase 3: 0 ~ 4999 (5,000개)
// Phase 4: 0 ~ 9999 (10,000개)
// Phase 5: 0 ~ 9999 (새 key 없이 기존만)

const phases = [
  { keys: Math.min(100, maxKeys) },
  { keys: Math.min(1000, maxKeys) },
  { keys: Math.min(5000, maxKeys) },
  { keys: maxKeys },
  { keys: maxKeys },  // Phase 5: 같은 수, 새 key 없음
];

export const options = {
  scenarios: {
    phase1_100keys: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '100'),
      duration: phaseDuration,
      exec: 'phase1',
      startTime: '0m',
    },
    phase2_1000keys: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '100'),
      duration: phaseDuration,
      exec: 'phase2',
      startTime: phaseDuration,
    },
    phase3_5000keys: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '100'),
      duration: phaseDuration,
      exec: 'phase3',
      startTime: `${parseInt(phaseDuration) * 2}m`,
    },
    phase4_10000keys: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '100'),
      duration: phaseDuration,
      exec: 'phase4',
      startTime: `${parseInt(phaseDuration) * 3}m`,
    },
    phase5_stable: {
      executor: 'constant-vus',
      vus: parseInt(__ENV.VUS || '100'),
      duration: phaseDuration,
      exec: 'phase5',
      startTime: `${parseInt(phaseDuration) * 4}m`,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
};

function callWithKey(phaseIndex) {
  const keyRange = phases[phaseIndex].keys;
  const keyId = Math.floor(Math.random() * keyRange);
  const paddedKey = String(keyId).padStart(6, '0');

  // /mock/delay/100ms/size/1kb/id/000123
  // BFF가 이 path 전체 또는 /id/{값} 부분을 command key로 사용
  const res = http.get(`${BFF}/mock/delay/100ms/size/1kb/id/${paddedKey}`);
  responseTime.add(res.timings.duration);
  uniqueKeys.add(keyRange);

  if (!check(res, { 'status ok': (r) => r.status === 200 })) {
    keyErrors.add(1);
  }
}

export function phase1() { callWithKey(0); }
export function phase2() { callWithKey(1); }
export function phase3() { callWithKey(2); }
export function phase4() { callWithKey(3); }
export function phase5() { callWithKey(4); }
