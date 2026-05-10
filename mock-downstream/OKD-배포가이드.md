# Mock Downstream — OKD 배포 가이드

이 디렉토리의 `Dockerfile`, `deployment.yaml`, `service.yaml`을 OKD에 배포할 때의 결정 근거와 운영 메모.

---

## 빌드 / 배포 순서

```bash
# 1. 빌드 & 푸시
docker build -t your-registry.example.com/mock-downstream:v1 .
docker push your-registry.example.com/mock-downstream:v1

# 2. namespace + SCC 사전 작업
oc new-project test
oc adm policy add-scc-to-user nonroot-v2 -z default -n test

# 3. 배포
oc apply -f deployment.yaml -n test
oc apply -f service.yaml    -n test

# 4. 확인
oc get pods -n test -l app=mock-downstream
oc logs -n test -l app=mock-downstream
oc port-forward -n test svc/mock-downstream 8080:8080
curl http://localhost:8080/health
```

### 배포 전 체크리스트

- [ ] `image: your-registry.example.com/...` → 실제 레지스트리 경로로 교체
- [ ] BFF route table에 `/mock` → `mock-downstream.test.svc:8080` 추가
- [ ] OKD가 외부 레지스트리 pull 가능 (없으면 `imagePullSecrets` 필요)
- [ ] Istio 사용 여부에 따라 `sidecar.istio.io/inject` 값 결정

---

## 1. Dockerfile — distroless static + 정적 바이너리

| 결정 | 이유 |
|------|------|
| `CGO_ENABLED=0` 정적 빌드 | libc 의존성 제거 → distroless static 이미지에서 동작 |
| `gcr.io/distroless/static-debian12:nonroot` | 셸·패키지 매니저 없음. 약 2MB. 공격 표면 최소 |
| `-trimpath -ldflags="-s -w"` | 빌드 정보·심볼 제거 → 작고 재현 가능한 빌드 |
| `USER nonroot:nonroot` | 명시적 non-root. **OKD가 SCC로 UID override** 하지만 명시는 좋은 관행 |

> **핵심**: 정적 바이너리는 `/etc/passwd` 룩업을 안 하므로 OKD가 임의 UID(예: 1000600000)로 실행해도 동작.

---

## 2. SecurityContext — restricted-v2 SCC 호환

| 설정 | 의도 |
|------|------|
| `runAsUser` / `fsGroup` **미지정** | SCC가 namespace 범위(예: 1000600000~)에서 자동 할당. 명시하면 SCC 위반 |
| `runAsNonRoot: true` | OKD 필수 |
| `allowPrivilegeEscalation: false` | restricted-v2 강제 |
| `capabilities.drop: [ALL]` | 권한 최소화 |
| `readOnlyRootFilesystem: true` | mock은 디스크 안 씀 → 더 엄격하게 |
| `seccompProfile: RuntimeDefault` | OKD 4.11+ 강제 |

### 사전 작업

```bash
oc adm policy add-scc-to-user nonroot-v2 -z default -n test
```

> 전용 ServiceAccount를 만들고 거기에만 SCC를 부여하는 게 더 안전 (default SA 대신).

---

## 3. Go 런타임 — GOMAXPROCS 자동 인식 안 됨

```yaml
env:
  - name: GOMAXPROCS
    valueFrom:
      resourceFieldRef:
        resource: limits.cpu        # downwardAPI로 주입
  - name: GOMEMLIMIT
    valueFrom:
      resourceFieldRef:
        resource: limits.memory
```

| 문제 | 해결 |
|------|------|
| Go 런타임은 cgroup CPU limit을 **자동 인식 못함** (Java VT는 인식함) | `limits.cpu`를 downwardAPI로 GOMAXPROCS env 주입 |
| `/proc/cpuinfo` 보고 노드 전체 CPU 수만큼 P 생성 → 불필요한 context switch | P 수 = limit과 일치 → 효율적 |
| limits.cpu=500m → GOMAXPROCS=1 (올림) | 정수 cpu (예: `"1"`, `"2"`) 권장 |
| GC가 cgroup memory 한계 모름 → OOM 위험 | `GOMEMLIMIT` (Go 1.19+) 으로 한계 알림 |

> 더 깊은 동시성 모델 차이는 [[concurrency/Go-고루틴-vs-Java-스레드]] 참고.

---

## 4. QoS — Guaranteed 고정

```yaml
resources:
  requests: { cpu: "1", memory: "256Mi" }
  limits:   { cpu: "1", memory: "256Mi" }   # ← requests = limits
```

| 이유 | |
|------|---|
| **테스트 환경에서는 throttling/eviction이 결과를 왜곡** | requests = limits → Guaranteed QoS |
| CPU 정수(`"1"`) | 소수면 GOMAXPROCS=1로 올림되지만 실제 CPU time은 0.5라 throttling 발생 |
| 양쪽 동일하게 | A/B 비교 공정성 (Java 8 vs Java 25 환경에서도 동일하게 적용) |

> JVM 컨테이너 리소스 인식 디테일은 [[spring/JVM-컨테이너-리소스-인식]] 참고.

---

## 5. 단일 인스턴스 + Recreate 전략

```yaml
spec:
  replicas: 1
  strategy:
    type: Recreate
```

| 이유 | |
|------|---|
| mock의 schedule/config가 **메모리 상태** | 분산되면 일관성 깨짐 (replicas>1 금지) |
| 롤링 업데이트 시 신구 pod 동시 존재하면 절반은 옛 schedule 따름 | `Recreate` — 신구 pod 동시 존재 금지 |
| HPA 적용 안 함 | 부하에 따라 pod 늘어나면 동일 문제 |

> 만약 **확장 가능한 mock이 필요**하면 schedule을 외부 store(예: ConfigMap 또는 Redis)로 옮겨야 함. 현재는 단일 인스턴스로 충분.

---

## 6. 헬스 프로브 3종

| 프로브 | 역할 | 설정 |
|--------|------|------|
| `startupProbe` | 시작 직후 빠르게 ready 판정 | period 1s, failure 10 |
| `readinessProbe` | Service traffic 라우팅 기준 | period 5s, failure 3 |
| `livenessProbe` | hang 시 재시작 | period 10s, failure 3 |

mock의 `/health`는 즉시 200 반환하므로 짧은 주기로 OK.

---

## 7. Istio Sidecar

```yaml
sidecar.istio.io/inject: "true"
```

| 선택 | 의미 |
|------|------|
| `"true"` (기본) | 운영 환경(BFF)이 Istio면 mock도 sidecar 통해 동일 mTLS 경로 → 운영과 다른 latency 패턴 회피 |
| `"false"` | sidecar 자체가 ~5ms latency 추가 → 순수 BFF 성능만 보고 싶을 때 |

> A/B 비교(Java 8 vs Java 25)에서는 양쪽 동일하게 sidecar 유무를 맞춰야 함.

### Sidecar 병목 가능성

매 요청이 Envoy를 4번 거침 (k6→BFF inbound + BFF→Mock outbound + Mock inbound + 응답 경로). 부하 패턴에 따라 **앱보다 sidecar가 먼저 병목**이 될 수 있음.

| 부하 패턴 | sidecar 병목 |
|-----------|--------------|
| 고RPS + 작은 payload (5k+ RPS) | 🔴 Envoy CPU 포화가 앱보다 먼저 |
| TLS handshake 폭주 (keep-alive 안 됨) | 🔴 핸드셰이크 비용 누적 |
| 저RPS + 큰 payload | 🟡 bytes copy 오버헤드 |

### 권장 sidecar 리소스 (기본값이 작음)

```yaml
metadata:
  annotations:
    sidecar.istio.io/proxyCPU:        "500m"
    sidecar.istio.io/proxyMemory:     "128Mi"
    sidecar.istio.io/proxyCPULimit:   "2000m"
    sidecar.istio.io/proxyMemoryLimit:"512Mi"
```

> 기본 Envoy CPU 100m는 고RPS에서 즉시 throttle.

### 진단 빠른 명령

```bash
# istio-proxy CPU가 앱 컨테이너보다 먼저 100% 도달하면 sidecar 병목
oc top pods -n test --containers

# Envoy 내부 메트릭
oc exec -n test <pod> -c istio-proxy -- \
  curl -s localhost:15000/stats | grep -E "(overflow|rq_pending|cx_active)"
```

> 평소 모니터링 메트릭/대시보드 셋업과 자세한 진단·완화 전략은 [[istio/Istio-Sidecar-병목-진단]] 참고.

---

## 8. Prometheus 스크레이핑

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "8080"
  prometheus.io/path: "/metrics"
```

- mock의 `/metrics` 엔드포인트가 자동 수집됨
- Grafana에서 `mock_downstream_*` 메트릭으로 BFF 메트릭과 비교 가능
- **mock 자체 latency**를 같이 측정해 BFF 병목 / mock 병목 구분 가능

### OKD cluster monitoring 사용 시

annotation 방식은 user workload monitoring 활성화 필요:

```bash
oc apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: cluster-monitoring-config
  namespace: openshift-monitoring
data:
  config.yaml: |
    enableUserWorkload: true
EOF
```

또는 `ServiceMonitor` CR로 변경:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: mock-downstream
  namespace: test
spec:
  selector:
    matchLabels:
      app: mock-downstream
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

---

## 9. 트러블슈팅

| 증상                                                           | 원인 / 해결                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `oc get pods` → `CreateContainerError` 또는 `CrashLoopBackOff` | SCC 위반 — `oc describe pod` 에서 SCC 메시지 확인                                             |
| `image pull backoff`                                         | private registry pullSecret 누락 → `oc create secret docker-registry ...` 후 SA에 attach |
| pod ready인데 Service 연결 안 됨                                   | NetworkPolicy 또는 Istio AuthorizationPolicy 차단 가능성                                    |
| BFF에서 호출 시 503                                               | BFF route table에 `/mock` 매핑 누락 또는 잘못됨                                                |
| latency 측정 결과가 너무 들쭉날쭉                                       | requests ≠ limits로 인한 throttling — Guaranteed QoS 확인                                 |
| GC pause 자주 발생                                               | `GOMEMLIMIT` 미주입 또는 너무 작음                                                            |

---

## 10. 참고 — 관련 dev-notes

- [[concurrency/Go-고루틴-vs-Java-스레드]] — mock이 왜 BFF에 비해 가벼운지
- [[spring/JVM-컨테이너-리소스-인식]] — limits vs requests, MaxRAMPercentage
- [[k8s/k6-operator-운영가이드]] — k6를 클러스터 내부에서 실행
