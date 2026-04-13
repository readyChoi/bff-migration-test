// H 시리즈: Hystrix 메모리 누적 관찰
//
// 목적: 장시간 운행 시 Hystrix command metrics / RxJava 내부 버퍼로 인한
//       힙 메모리 증가 + Full GC 반복 패턴을 Java 8+Hystrix vs Java 25+R4j로 비교
//
// G-1(Soak)과 다른 점:
//   - 더 긴 시간 (기본 2시간)
//   - 부하 패턴을 변화시켜 rolling window 갱신을 유도
//   - 중간중간 부하를 끊었다가 다시 줘서 idle 시 메모리 반환 여부 확인
//
// 사용법:
//   k6 run scenario-h-memory-leak.js
//   k6 run -e DURATION=3h scenario-h-memory-leak.js
//
// 함께 실행:
//   ./monitor-heap.sh &   (별도 터미널에서 힙/GC 주기적 기록)

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Gauge } from 'k6/metrics';
import { BFF, MOCK, getMockMetrics } from './common.js';

const responseTime = new Trend('h_response_time', true);
const iterationGauge = new Gauge('h_total_iterations');

// 전체 시간을 4개 phase로 나눔
// Phase 1: 안정 부하 (baseline 힙 측정)
// Phase 2: 부하 증가 (rolling window에 더 많은 데이터 축적)
// Phase 3: 부하 중단 (idle 시 메모리 반환되는지)
// Phase 4: 부하 재개 (메모리가 다시 올라가는지, 이전보다 높은지)

const totalMinutes = parseInt(__ENV.DURATION_MINUTES || '120');  // 기본 2시간
const phaseMinutes = Math.floor(totalMinutes / 4);

export const options = {
  scenarios: {
    // Phase 1: 안정 부하 (VU 100)
    phase1_steady: {
      executor: 'constant-vus',
      vus: 100,
      duration: `${phaseMinutes}m`,
      exec: 'normalLoad',
      startTime: '0m',
    },
    // Phase 2: 부하 증가 (VU 300)
    phase2_heavy: {
      executor: 'constant-vus',
      vus: 300,
      duration: `${phaseMinutes}m`,
      exec: 'heavyLoad',
      startTime: `${phaseMinutes}m`,
    },
    // Phase 3: 부하 중단 (VU 5, 최소한의 health check만)
    phase3_idle: {
      executor: 'constant-vus',
      vus: 5,
      duration: `${phaseMinutes}m`,
      exec: 'idleLoad',
      startTime: `${phaseMinutes * 2}m`,
    },
    // Phase 4: 부하 재개 (VU 100, Phase 1과 동일)
    phase4_resume: {
      executor: 'constant-vus',
      vus: 100,
      duration: `${phaseMinutes}m`,
      exec: 'normalLoad',
      startTime: `${phaseMinutes * 3}m`,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
};

// Phase 1, 4: 일반 부하
export function normalLoad() {
  const res = http.get(`${BFF}/mock/delay/100ms/size/10kb`);
  responseTime.add(res.timings.duration);
  check(res, { 'status ok': (r) => r.status === 200 });
}

// Phase 2: 무거운 부하 (다양한 delay/size 섞어서 rolling window에 다양한 데이터 축적)
export function heavyLoad() {
  const patterns = [
    { delay: '50ms',  size: '1kb' },
    { delay: '100ms', size: '10kb' },
    { delay: '200ms', size: '50kb' },
    { delay: '500ms', size: '100kb' },
    { delay: '1s',    size: '1kb' },
  ];
  const p = patterns[Math.floor(Math.random() * patterns.length)];
  const res = http.get(`${BFF}/mock/delay/${p.delay}/size/${p.size}`);
  responseTime.add(res.timings.duration);
  check(res, { 'status ok': (r) => r.status === 200 });
}

// Phase 3: 거의 idle (메모리 반환 관찰)
export function idleLoad() {
  http.get(`${BFF}/mock/delay/10ms/size/1kb`);
  sleep(2);  // 2초 간격으로 느리게
}
