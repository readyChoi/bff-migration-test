import http from 'k6/http';

// ── BFF / Mock 설정 ──

const BFF_HOST = __ENV.BFF_HOST || 'http://bff.test.svc';
const MOCK_HOST = __ENV.MOCK_HOST || 'mock-downstream.test.svc';

// ── BFF 호출 (테스트 요청) ──

export function callMock(delay, size) {
  return http.get(`${BFF_HOST}/mock/delay/${delay}/size/${size}`);
}

export function callMockWithError(delay, size, errorRate) {
  return http.get(`${BFF_HOST}/mock/delay/${delay}/size/${size}/error/${errorRate}`);
}

// ── Mock 직접 설정 (schedule, reset 등) ──

export function configureMock(config) {
  const res = http.put(`http://${MOCK_HOST}:8080/config`, JSON.stringify(config), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200) {
    console.error(`Failed to configure mock: ${res.status}`);
  }
}

export function configureRoutes(routeMap) {
  const res = http.put(`http://${MOCK_HOST}:8080/config/routes`, JSON.stringify(routeMap), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200) {
    console.error(`Failed to configure routes: ${res.status}`);
  }
}

export function resetMock() {
  http.post(`http://${MOCK_HOST}:8080/reset`);
}

export function getMockMetrics() {
  return JSON.parse(http.get(`http://${MOCK_HOST}:8080/metrics`).body);
}

// ── Request Body 생성 ──

export function generatePayload(sizeBytes) {
  const base = { timestamp: Date.now(), type: 'test' };
  const padding = 'x'.repeat(Math.max(0, sizeBytes - JSON.stringify(base).length - 20));
  base.data = padding;
  return JSON.stringify(base);
}

export const PAYLOADS = {
  small:      generatePayload(500),       // ~500B
  medium:     generatePayload(5000),      // ~5KB
  large:      generatePayload(50000),     // ~50KB
  very_large: generatePayload(500000),    // ~500KB
};
