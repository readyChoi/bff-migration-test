// 공통 설정 및 유틸리티
// 모든 시나리오 스크립트에서 import 해서 사용

import http from 'k6/http';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

// ── 환경변수 ──

export const BFF = __ENV.BFF_HOST || 'http://bff.test.svc';
export const MOCK = __ENV.MOCK_HOST || 'http://mock-downstream.test.svc';
export const DELAY = __ENV.DELAY || '100ms';
export const SIZE = __ENV.SIZE || '1kb';
export const ERROR_RATE = __ENV.ERROR_RATE || '0';

// ── Custom Metrics ──

export const mockLatency = new Trend('mock_latency', true);
export const errorCount = new Counter('custom_errors');

// ── 요청 헬퍼 ──

export function mockGet(delay, size, opts) {
  const url = `${BFF}/mock/delay/${delay}/size/${size}`;
  const res = http.get(url, opts);
  mockLatency.add(res.timings.duration);
  checkResponse(res);
  return res;
}

export function mockGetWithError(delay, size, errorRate, opts) {
  const url = `${BFF}/mock/delay/${delay}/size/${size}/error/${errorRate}`;
  const res = http.get(url, opts);
  mockLatency.add(res.timings.duration);
  if (res.status >= 500) errorCount.add(1);
  return res;
}

export function mockPost(delay, size, body, opts) {
  const url = `${BFF}/mock/delay/${delay}/size/${size}`;
  const headers = { 'Content-Type': 'application/json', ...(opts?.headers || {}) };
  const res = http.post(url, body, { ...opts, headers });
  mockLatency.add(res.timings.duration);
  checkResponse(res);
  return res;
}

// path 파라미터 없이 호출 (global config/schedule 사용 시)
export function mockRaw(path, opts) {
  const url = `${BFF}/mock${path || '/api/test'}`;
  const res = http.get(url, opts);
  mockLatency.add(res.timings.duration);
  return res;
}

function checkResponse(res) {
  check(res, {
    'status 200': (r) => r.status === 200,
  });
}

// ── Request Body 생성 ──

export function generatePayload(sizeBytes) {
  const base = { timestamp: Date.now(), type: 'test' };
  const padding = 'x'.repeat(Math.max(0, sizeBytes - JSON.stringify(base).length - 20));
  base.data = padding;
  return JSON.stringify(base);
}

export const PAYLOADS = {
  '500b':  generatePayload(500),
  '5kb':   generatePayload(5000),
  '50kb':  generatePayload(50000),
  '500kb': generatePayload(500000),
};

// ── Mock 관리 ──

export function resetMock() {
  http.post(`${MOCK}:8080/reset`);
}

export function configureMock(config) {
  http.put(`${MOCK}:8080/config`, JSON.stringify(config), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function scheduleMock(phases) {
  http.put(`${MOCK}:8080/config/schedule`, JSON.stringify({ phases }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function getMockMetrics() {
  return JSON.parse(http.get(`${MOCK}:8080/metrics`).body);
}

// ── 공통 Thresholds ──

export const defaultThresholds = {
  http_req_duration: ['p(95)<3000'],
  http_req_failed: ['rate<0.10'],
};
