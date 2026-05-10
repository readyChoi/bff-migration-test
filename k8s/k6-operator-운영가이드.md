# k6-operator 운영 가이드

클러스터 내부에서 k6 부하 테스트를 Kubernetes Job으로 실행하기 위한 operator.

---

## 개념

| 리소스                          | 역할                                     |
| ---------------------------- | -------------------------------------- |
| **k6-operator** (controller) | `TestRun` CR을 watch → runner Job 생성    |
| **TestRun** CR               | 테스트 실행 단위. parallelism, script, env 정의 |
| **Initializer Pod**          | 스크립트 검증, VU 분배 계획 수립 (1회)              |
| **Runner Pod (n개)**          | `parallelism` 만큼 생성. 실제 부하 발생          |
| **Starter Pod**              | runner들을 동시에 시작시키는 신호 발사 (1회)          |

```
TestRun CR
    │
    ▼
[initializer] ─→ [runner-1] ┐
                 [runner-2] ├─ 동시 시작 by [starter]
                 [runner-N] ┘
```

---

## 설치 (Helm)

```bash
helm repo add grafana https://grafana.github.io/helm-charts
helm repo update
helm install k6-operator grafana/k6-operator \
  -n k6-operator-system --create-namespace \
  -f values.yaml
```

설치 후 확인:
```bash
kubectl get pods -n k6-operator-system
kubectl get crd | grep k6.io
# testruns.k6.io 가 있어야 함
```

---

## 스크립트 패키징

### ① ConfigMap (간단, ≤1MB)

```bash
kubectl create configmap k6-scripts -n test \
  --from-file=common.js \
  --from-file=scenario-a-latency.js
```

> 여러 시나리오를 함께 넣어도 됨. `import './common.js'` 가 동일 디렉토리에서 해석되도록 마운트됨.

### ② PVC (큰 스크립트, 결과 파일 저장)

```yaml
volumes:
  - name: scripts
    persistentVolumeClaim:
      claimName: k6-scripts-pvc
```

### ③ Git init container (스크립트 버전 관리)

```yaml
runner:
  initContainers:
    - name: git-clone
      image: alpine/git
      args: ["clone", "https://github.com/.../bff-migration-test.git", "/scripts"]
```

---

## TestRun CR 예시

```yaml
apiVersion: k6.io/v1alpha1
kind: TestRun
metadata:
  name: scenario-a-latency
  namespace: test
spec:
  parallelism: 4                       # runner pod 수
  cleanup: post                        # 성공 시 자동 정리
  separate: false                      # 모든 runner 동일 스크립트
  script:
    configMap:
      name: k6-scripts
      file: scenario-a-latency.js
  runner:
    image: grafana/k6:0.50.0
    env:
      - { name: BFF_HOST,  value: "http://bff.test.svc" }
      - { name: MOCK_HOST, value: "http://mock-downstream.test.svc" }
      - { name: DELAY,     value: "100ms" }
      - { name: SIZE,      value: "1kb" }
    resources:
      requests: { cpu: "1",   memory: "512Mi" }
      limits:   { cpu: "2",   memory: "1Gi" }
  arguments: --tag scenario=A-1 -o experimental-prometheus-rw
```

---

## VU 분배

```
spec:
  parallelism: 4
  
스크립트의 vus: 100  →  runner pod 1개당 25 VU
ramping-vus stages도 pod별로 동작 (총량 = 합)
```

| 시나리오 | parallelism 권장 |
|----------|------------------|
| latency / size / concurrency | 2~4 |
| soak (30분~) | 1~2 |
| memory-leak (장시간 관찰) | **1** (메모리 관찰 일관성) |
| mixed | 1 |

---

## 결과 수집

| 출력 | 설정 | 비고 |
|------|------|------|
| stdout 로그 | 기본 | `kubectl logs -l k6_cr=<name>` |
| Prometheus Remote Write | `K6_PROMETHEUS_RW_SERVER_URL` env | Grafana 대시보드와 연동 |
| InfluxDB | `arguments: -o influxdb=...` | 레거시 |
| JSON / CSV | `arguments: -o json=/results/out.json` | PVC 마운트 필요 |

### Prometheus 연동 예시

```yaml
runner:
  env:
    - name: K6_PROMETHEUS_RW_SERVER_URL
      value: "http://prometheus.monitoring.svc:9090/api/v1/write"
    - name: K6_PROMETHEUS_RW_TREND_STATS
      value: "p(95),p(99),min,max,avg"
arguments: -o experimental-prometheus-rw --tag scenario=A-1
```

---

## 실행 / 모니터링 / 정리

```bash
kubectl apply -f testrun-scenario-a.yaml

# 상태 확인
kubectl get testruns -n test
kubectl describe testrun scenario-a-latency -n test

# 로그 (모든 runner)
kubectl logs -l k6_cr=scenario-a-latency -n test -f --max-log-requests=10

# 정리
kubectl delete testrun scenario-a-latency -n test
```

| TestRun phase | 의미 |
|---------------|------|
| `initialization` | initializer pod 실행 중 |
| `created` | runner pod 생성됨, 시작 대기 |
| `started` | 부하 진행 중 |
| `finished` | 완료 |
| `error` | 실패 |

---

## OKD/OpenShift 주의사항

OpenShift는 기본 SCC가 `restricted-v2`라서 일반 k8s manifest와 다른 제약이 있다.

### SCC 제약

| 제약 | 의미 |
|------|------|
| `runAsUser`: 임의 UID 강제 | manifest에서 UID 지정 시 SCC 위반 |
| `fsGroup`: 임의 GID 강제 | 마찬가지 |
| `runAsNonRoot: true` 필수 | root 컨테이너 거부 |
| `allowPrivilegeEscalation: false` | privileged 거부 |
| capabilities `drop: [ALL]` | 권한 최소화 |
| `seccompProfile: RuntimeDefault` | 프로필 강제 |

### 권장 대응

1. **manifest에서 `runAsUser`/`fsGroup` 제거** → SCC가 자동 할당 (가장 안전)
2. **kube-rbac-proxy 비활성화** — 사이드카가 8443에서 root 권한 필요할 수 있음
3. **ServiceAccount에 SCC 명시 바인딩** (필요 시):
   ```bash
   oc adm policy add-scc-to-user nonroot-v2 -z k6-operator -n k6-operator-system
   ```

### 같은 namespace에서 실행

operator와 TestRun이 다른 namespace일 때 RBAC 누락 흔함. operator의 ClusterRole이 TestRun 대상 namespace의 Pod/ConfigMap 권한을 가져야 한다.

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
|------|-------------|
| TestRun stuck in `initialization` | initializer pod 로그 확인 — script 문법 오류 빈번 |
| `image pull backoff` | OKD private registry 시 pullSecret 누락 |
| runner pod CrashLoopBackOff | OKD SCC 위반 — `oc describe pod` 에서 SCC 메시지 확인 |
| Prometheus RW 안 됨 | `experimental-prometheus-rw` output 옵션 + endpoint reachable 확인 |
| `parallelism` 늘려도 부하 안 늘어남 | k6 runner CPU/memory limits 부족, 또는 BFF가 bottleneck |

---

## 한계

- **TestRun은 1회성 Job** — CronJob 형태 아님. 정기 실행은 별도 CronJob이 TestRun manifest를 apply
- **runner 간 상태 공유 없음** — 각 pod이 독립적인 k6 인스턴스. setup/teardown은 initializer/finalizer에서 한 번만 실행됨에 주의
- **VU 분배 정확도** — 정수 분할이라 `parallelism: 3` + `vus: 10` → 4/3/3

---

## 현재 k6-scripts 호환성 체크

`bff-migration-test/k6-scripts/` 검증 결과.

| 파일 | 호환 | 비고 |
|------|------|------|
| **common.js** | ✅ (수정 완료) | `BFF` / `MOCK` base URL에 포트(`:8080`) 포함. 호출부에서 추가 포트 안 붙임 |
| scenario-a/b/c/e/f2/g/mixed | ✅ | constant-vus / ramping-vus — k6-operator가 `parallelism` 으로 VU 자동 분배 |
| scenario-f3-cb-lifecycle | ✅ | `setup()`의 `scheduleMock()` — initializer pod에서 1회 실행 후 mock 서버에 등록 → 모든 runner가 동일 schedule 사용. 의도대로 동작 |
| scenario-h-memory-leak | ✅ | 4 phase startTime 순차 실행. 모든 runner가 동일 schedule 따르므로 phase 순서 유지 |
| scenario-h2-key-growth | ✅ | `parseInt('20m')` = 20 → `'40m'` 계산 정상 |

### k6-operator 환경 운영 메모

- **BFF_HOST / MOCK_HOST**: common.js 기본값이 `:8080` 포함이므로 그대로 사용. Service 포트가 다르면 env로 override
- **setup/teardown 1회 실행 특성과 mock**:
  - `scenario-f3` setup의 `scheduleMock` → 정상 (mock은 단일 서버, 1회 등록으로 모든 runner가 공유)
  - teardown의 `resetMock` → 정상 (cleanup 1회면 충분)
- **mock은 단일 인스턴스 유지 권장** — replicas>1 이면 schedule이 pod별로 분산되어 일관성 깨짐
- **VU 분배 예시**:
  - `scenario-a` `vus: 200` + `parallelism: 4` → pod당 50 VU (총 200)
  - `scenario-h` (memory-leak) → `parallelism: 1` 권장 (메모리 관찰 일관성)
  - `scenario-h2` (key-growth) → `parallelism: 1` 권장 (key 누적이 목적이라 분산 의미 없음)
