# Q&A

테스트 계획 진행 중 생긴 궁금한 점들을 모아두는 페이지.

---

## Q1. JFR(JDK Flight Recorder) 녹화가 뭐야?

JFR은 JVM에 내장된 **상시 프로파일링/이벤트 기록 시스템**이다. 비행기의 블랙박스(Flight Recorder)처럼, JVM 내부에서 일어나는 일을 기록해두고 나중에 분석하는 도구다.

### 기록하는 것들
- GC 발생 시점, 소요 시간
- 스레드 생성/종료/대기
- CPU 사용량, 힙 메모리 변화
- 메서드별 실행 시간 (hot method)
- I/O 대기 시간
- Virtual Thread 이벤트 (Java 21+)

### 사용 방법

```bash
# 방법 1: JVM 시작 시 녹화 시작
java -XX:StartFlightRecording=duration=300s,filename=test.jfr -jar bff.jar

# 방법 2: 실행 중인 JVM에 녹화 명령
jcmd <PID> JFR.start name=my-recording duration=300s filename=/tmp/test.jfr

# 녹화 파일 확인
jcmd <PID> JFR.check

# 수동 중지
jcmd <PID> JFR.stop name=my-recording
```

### 분석 방법
- **JDK Mission Control (JMC)** — GUI로 .jfr 파일을 열어서 시각화
- **jfr 커맨드** — CLI로 요약 확인: `jfr summary test.jfr`

### 녹화 결과물
`.jfr` 바이너리 파일이 생성되며, JMC로 열면 아래 같은 화면을 볼 수 있다:
- GC 타임라인 / pause 히스토그램
- 스레드 수 변화 그래프
- Hot method 목록 (CPU를 많이 쓴 메서드)
- Flame graph (호출 스택 시각화)

---

## Q2. JFR 녹화 시 부하가 있나?

**거의 없다.** Oracle/OpenJDK 공식 문서에서 **오버헤드 2% 미만**이라고 명시하고 있다.

| 항목 | 설명 |
|------|------|
| CPU 오버헤드 | 일반적으로 **1% 미만**, 최대 2% |
| 메모리 오버헤드 | 이벤트 버퍼용 수 MB (기본 설정 기준) |
| I/O 오버헤드 | 디스크에 주기적으로 flush, 무시할 수준 |
| 운영 환경 사용 | **가능** — 원래 프로덕션 상시 녹화용으로 설계됨 |

### 왜 가벼운가
- 이벤트를 메모리 버퍼에 쌓았다가 일괄 flush (실시간 I/O 아님)
- 샘플링 기반 (모든 이벤트를 기록하는 게 아님)
- JVM 내부에 네이티브로 통합되어 있어 외부 에이전트 방식보다 가벼움

### 프로파일 설정에 따른 차이

```bash
# 기본 프로파일 (가벼움, 운영용)
-XX:StartFlightRecording=settings=default,...

# 상세 프로파일 (이벤트 더 많이 수집, 개발/테스트용)
-XX:StartFlightRecording=settings=profile,...
```

| 프로파일 | 오버헤드 | 용도 |
|----------|----------|------|
| `default` | ~1% | 운영 환경 상시 녹화 |
| `profile` | ~2% | 성능 테스트/개발 환경에서 상세 분석 |

### 결론
성능 테스트 중에 JFR을 켜도 **테스트 결과에 유의미한 영향을 주지 않는다.** Java 8 / Java 25 양쪽 모두 JFR을 켜고 테스트해도 공정한 비교가 가능하다.

> 단, Java 8에서는 JFR이 Oracle JDK에서만 사용 가능했고 (상용 라이선스 필요), OpenJDK 11부터 오픈소스로 풀렸다. Java 8 환경이 OpenJDK라면 JFR 대신 `async-profiler`를 사용해야 한다.

---

## Q3. Chaos Mesh 같은 도구는 BFF 테스트에 안 써도 되나?

이번 테스트의 핵심은 **payload 크기, downstream 응답시간, CB 상태 전이** 제어인데, 이건 Chaos Mesh의 강점이 아니다.

### Chaos Mesh vs 현재 도구 조합

| 필요한 기능 | Istio + Go Mock | Chaos Mesh |
|------------|----------------|------------|
| downstream 응답 지연 | O | O |
| HTTP 에러 + body 커스텀 | O | X (status code만) |
| payload 크기 제어 | O | X |
| N번째 요청 후 실패 (CB 유도) | O | X |
| Pod kill / restart | X | **O** |
| 네트워크 파티션 (BFF ↔ downstream 단절) | X | **O** |
| BFF pod에 CPU/Memory pressure 주입 | X | **O** (StressChaos) |

### 결론

**이번 성능 테스트에서는 불필요.** Istio Fault Injection + Go Mock 서비스로 모든 시나리오를 커버할 수 있다.

### 나중에 Chaos Mesh가 유용한 경우

다음 단계로 **운영 안정성/복원력 테스트**를 할 때는 고려할 만하다:

- BFF pod이 갑자기 죽었을 때 k8s가 재시작하는 동안의 요청 유실량 측정
- Istio sidecar가 죽었을 때 BFF 동작 확인
- BFF pod에 CPU throttling을 걸어서 리소스 부족 시 Virtual Thread의 degradation 패턴 관찰
- downstream과의 네트워크가 완전히 끊겼을 때 (Istio delay/abort와 다름) CB + timeout 조합 동작 확인

이런 시나리오는 성능 비교가 아니라 **장애 대응 검증**이므로, Java 25 마이그레이션이 안정화된 이후에 별도로 진행하는 게 맞다.

---

## Q4. BFF의 각 기능(인증, 권한, 파일, 라우팅 등)별로 따로 테스트해야 하나?

**아니다.** 이번 테스트는 "기능이 잘 동작하는가"가 아니라 "Java 8 vs 25에서 성능이 얼마나 차이나는가"를 보는 것이다.

Virtual Thread의 효과는 **기능 이름이 아니라 I/O 패턴**에 의해 결정된다:

- **CPU bound** (인증 토큰 검증, 권한 체크) → VT 효과 거의 없음. 어차피 CPU에서 도는 거라 thread 모델 차이가 안 남
- **단일 downstream 호출** (단순 라우팅) → VT 효과 보통
- **다중 downstream 병렬 호출** (화면 조합 aggregation) → **VT 효과 극대화** (핵심)
- **대용량 I/O** (파일 업로드/다운로드) → 스트리밍 방식에 따라 다름
- **장시간 blocking** (외부 메시지 발송) → VT 효과 큼

같은 I/O 패턴의 기능은 결과가 유사하므로, **패턴별 대표 API 4~5개만** 테스트하면 충분하다. 인증/권한 체크는 filter/interceptor에서 모든 API에 공통 적용되므로 별도 테스트 불필요.

→ 상세 선정 기준은 [[05-시나리오-매트릭스]] 상단 참조

---

## Q5. BFF의 downstream URL을 mock으로 교체할 수 없을 때는?

BFF 코드나 설정을 수정하지 않고도, **네트워크 레벨에서 mock으로 라우팅**할 수 있다.

### 방법 1: 같은 이름의 Service를 test namespace에 만들기 (추천)

BFF가 `http://user-service/api/users`를 호출한다면:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-service      # BFF가 호출하는 이름 그대로
  namespace: test
spec:
  selector:
    app: mock-downstream    # mock pod을 바라봄
  ports:
    - port: 80
      targetPort: 8080
```

BFF도 test namespace에 배포하면, k8s DNS는 **같은 namespace의 Service를 먼저 resolve** → BFF는 코드 변경 없이 mock을 호출하게 된다.

- BFF 코드 변경: 없음
- 추가 설정: Service 이름만 실제 downstream과 맞추면 됨
- 주의: BFF가 FQDN(`user-service.prod.svc.cluster.local`)으로 호출하면 이 방법은 안 됨 → 방법 2 사용

### 방법 2: Istio VirtualService로 outbound 전부 가로채기 (추천)

BFF가 FQDN으로 호출하거나, downstream 목록을 모를 때. BFF pod에서 나가는 **모든 outbound를 mock으로** 보낸다.

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: catch-all-to-mock
  namespace: test
spec:
  hosts:
    - "*.prod.svc.cluster.local"    # prod의 모든 서비스
  http:
    - match:
        - sourceLabels:
            app: bff                 # test namespace의 BFF pod에서 나가는 트래픽에만 적용
      route:
        - destination:
            host: mock-downstream.test.svc.cluster.local
            port:
              number: 80
```

- downstream 이름을 몰라도 됨
- Service를 하나하나 안 만들어도 됨 (VirtualService 1개로 끝)
- `sourceLabels`로 **BFF pod에만 적용** → k6나 다른 pod에는 영향 없음
- mock의 Host 헤더에 원래 downstream 이름이 들어오므로 `PUT /config/routes`로 Host별 설정도 가능

### 방법 3: Test endpoint 만들기 (비추천)

위 방법이 모두 안 되는 경우에만. 운영 코드에 테스트 전용 endpoint를 추가해야 해서 코드가 오염된다.

### 결론

방법 2(VirtualService catch-all) > 방법 1(같은 이름 Service) > 방법 3(코드 수정). 상세는 [[08-추후-고려-사항]] 참조.

---

## Q6. k6를 실행하는 머신에 제한이 있나?

있다. k6가 부하를 생성하는 쪽이라 **k6 자체가 병목이 되면 테스트 결과가 왜곡**된다.

### 주요 제한

| 제한 | 설명 | 증상 |
|------|------|------|
| CPU | VU마다 goroutine 실행 | k6 CPU 100% → 요청 생성 속도가 못 따라감 → RPS가 기대보다 낮음 |
| 메모리 | VU 수 × 요청/응답 데이터 | B-4(1MB 응답) × VU 200 = 동시 200MB 수신. OOM 가능 |
| 파일 디스크립터 | VU당 TCP 연결 | VU 1000 → 동시 1000+ fd. `ulimit -n` 확인 필요 |
| 네트워크 | k6 → BFF 구간 대역폭 | 대용량 응답 시나리오에서 NIC 포화 가능 |
| 소스 포트 고갈 | TCP ephemeral port 부족 | `TIME_WAIT` 누적 → 연결 실패 |

### 목안

- **VU 500 이하**: 일반 노드(2 core, 4GB) 1개로 충분
- **VU 1000+**: k6 머신 스펙 확인 필요

### k6가 병목인지 확인하는 방법

```bash
# k6 실행 중 모니터링
top -p $(pgrep k6)    # CPU/메모리
ss -s                  # TCP 연결 수
ulimit -n              # fd 제한 (최소 65535 추천)
```

k6 결과에 `dropped_iterations` 메트릭이 나오면 **k6가 요청 생성을 못 따라가는 것** → VU를 줄이거나 k6 머신 스펙을 올려야 한다.

### k6를 클러스터 안에서 실행할 때

k6를 k8s pod으로 실행하면 네트워크 홉이 줄어들어 유리하다. 단, k6 pod의 리소스 request/limit을 충분히 잡아야 한다.

```yaml
resources:
  requests: { cpu: 2, memory: 4Gi }
  limits:   { cpu: 4, memory: 8Gi }
```

---

## Q7. BFF → Microservice 직접 호출 vs 중간에 API 레이어를 두는 구조의 차이는?

### 구조 비교

**A. BFF → Microservice (직접 호출, 더 일반적)**

```
클라이언트 → BFF → user-svc
                  → order-svc
                  → noti-svc
```

**B. BFF → API 레이어 → Microservice**

```
클라이언트 → BFF → Internal API GW → user-svc
                                    → order-svc
                                    → noti-svc
```

### 차이가 발생하는 이유

| 이유 | 설명 |
|------|------|
| BFF가 여러 개일 때 | web-bff, mobile-bff가 같은 API를 호출 → 공통 레이어로 추출 |
| 내부 인증/인가 통합 | BFF 간 공통 보안 로직을 API 레이어에서 한 번만 처리 |
| API 버전 관리 | microservice가 v1/v2를 동시에 제공할 때 API 레이어에서 라우팅 |
| 조직 구조 | 프론트팀(BFF) ↔ 백엔드팀(API) ↔ 도메인팀(MS)으로 나뉠 때 |

### 장단점

| | A. 직접 호출 | B. API 레이어 |
|-|-------------|--------------|
| latency | 낮음 (hop 1개) | 높음 (hop 2개) |
| 복잡도 | 단순 | 관리할 컴포넌트 추가 |
| 장애 포인트 | 적음 | API 레이어 장애 시 전체 영향 |
| BFF 독립성 | BFF가 MS를 직접 알아야 함 | BFF는 API만 알면 됨 |
| 공통 로직 | BFF마다 중복 가능 | API 레이어에서 한 번만 |
| 적합한 규모 | 소~중규모, BFF 1~2개 | 대규모, BFF 3개+, 팀이 분리 |

### 결론

BFF가 1개이고 팀이 나뉘어있지 않으면 **직접 호출(A)**이 표준. 레이어가 늘수록 latency와 복잡도가 증가하므로, 명확한 이유 없이 중간 레이어를 두는 건 오버엔지니어링.

---
