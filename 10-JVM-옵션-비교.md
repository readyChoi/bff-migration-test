# JVM 옵션 비교: Java 8 → 25 (G1GC)

## 기본값이 달라진 것들

Java 8과 25에서 **같은 옵션이지만 기본값이 다른** 것들. 명시하지 않으면 동작이 달라진다.

| 옵션 | Java 8 기본 | Java 25 기본 | 영향 |
|------|------------|-------------|------|
| `-XX:+UseG1GC` | 꺼짐 (Parallel GC가 기본) | **켜짐** | Java 8에서는 명시 필수, 25에서는 자동 |
| `-XX:+UseStringDeduplication` | 꺼짐 | 꺼짐 | 둘 다 기본 꺼짐이지만, 25에서 성능 개선됨 |
| `-XX:G1HeapRegionSize` | 자동 (1~32MB) | 자동 (더 스마트) | 25에서 자동 조정이 개선됨 |
| `-XX:MaxGCPauseMillis` | 200ms | 200ms | 동일하지만, 25의 G1이 더 잘 지킴 |
| `-XX:InitiatingHeapOccupancyPercent` | 45% | **adaptive** | 25에서는 자동 조절됨 (IHOP) |
| `-XX:+UseCompressedOops` | 켜짐 (<32GB heap) | 켜짐 | 동일 |
| `-XX:+TieredCompilation` | 켜짐 | 켜짐 | 동일하지만 C2 최적화가 더 좋아짐 |
| `-XX:ConcGCThreads` | 자동 | 자동 | 25에서 더 효율적 스레드 수 결정 |

---

## Java 25에서 새로 쓸 수 있는 옵션

### G1GC 관련

| 옵션 | 도입 | 설명 | 추천 |
|------|------|------|------|
| `-XX:G1PeriodicGCInterval=N` | Java 12 | 유휴 시 N ms마다 GC → OS에 메모리 반환 | 컨테이너 환경에서 메모리 절약. `15000` (15초) 정도 |
| `-XX:+G1PeriodicGCInvokesConcurrent` | Java 12 | 위 주기적 GC를 concurrent로 실행 (Full GC 아님) | `G1PeriodicGCInterval`과 함께 사용 |
| `-XX:G1MixedGCCountTarget=N` | Java 8에도 있지만 25에서 개선 | mixed GC를 N회에 걸쳐 처리 | 기본값(8) 유지 |
| `-XX:-G1UsePreventiveGC` | Java 17 | preventive GC 비활성화 | 기본 켜짐, 건드리지 않는 게 좋음 |

### Virtual Thread 관련

| 옵션 | 설명 | 추천 |
|------|------|------|
| `-Djdk.virtualThreadScheduler.parallelism=N` | VT carrier thread 수 | 기본값 = CPU 코어 수. 보통 안 건드림 |
| `-Djdk.virtualThreadScheduler.maxPoolSize=N` | carrier thread 최대 수 | 기본 256. pinning 발생 시 올리기 |
| `spring.threads.virtual.enabled=true` | Spring Boot에서 VT 활성화 | **필수 설정** |

### 메모리/성능

| 옵션 | 도입 | 설명 | 추천 |
|------|------|------|------|
| `-XX:+UseCompactObjectHeaders` | Java 24 (실험적) | 객체 헤더 크기 축소 (12B → 8B) | 실험적이라 성능 테스트에서는 비추 |
| `-XX:+UseStringDeduplication` | Java 8 | 중복 String을 G1이 자동 제거 | 25에서 성능이 개선됨. JSON 많으면 고려 |
| `-XX:+AlwaysPreTouch` | Java 8 | JVM 시작 시 heap 전체를 미리 할당 | 컨테이너에서 워밍업 시간 단축 |

---

## 제거되거나 바뀐 옵션

Java 8에서 쓰던 옵션 중 **25에서 제거/변경**된 것들. 이걸 그대로 쓰면 JVM이 시작 안 될 수 있다.

| 옵션 | 상태 | 대체 |
|------|------|------|
| `-XX:+UseConcMarkSweepGC` | **제거** (Java 14) | G1 사용 |
| `-XX:+UseParNewGC` | **제거** (Java 10) | G1 사용 |
| `-XX:+PrintGCDetails` | **제거** (Java 9) | `-Xlog:gc*` |
| `-XX:+PrintGCDateStamps` | **제거** (Java 9) | `-Xlog:gc*:time` |
| `-XX:+PrintGCTimeStamps` | **제거** (Java 9) | `-Xlog:gc*:time` |
| `-XX:+PrintAdaptiveSizePolicy` | **제거** (Java 9) | `-Xlog:gc+ergo` |
| `-XX:+UseAdaptiveSizePolicy` | G1에서는 무시 | G1은 자체 adaptive 로직 |
| `-Xloggc:/path/gc.log` | **제거** (Java 9) | `-Xlog:gc*:file=/path/gc.log` |
| `-XX:PermSize` / `-XX:MaxPermSize` | **제거** (Java 8) | `-XX:MetaspaceSize` / `-XX:MaxMetaspaceSize` |

### GC 로깅 변환 예시

```bash
# Java 8
-XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/tmp/gc.log

# Java 25
-Xlog:gc*:file=/tmp/gc.log:time,uptime,level,tags
```

---

## 테스트용 추천 JVM 옵션

### 이미지 A: Java 8 + Hystrix

```bash
java \
  -server \
  -Xms512m -Xmx512m \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:+PrintGCDetails -XX:+PrintGCDateStamps -Xloggc:/tmp/gc.log \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/tmp/heapdump.hprof \
  -jar bff.jar
```

### 이미지 B: Java 25 + VT + R4j

```bash
java \
  -server \
  -Xms512m -Xmx512m \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -Xlog:gc*:file=/tmp/gc.log:time,uptime,level,tags \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/tmp/heapdump.hprof \
  -XX:StartFlightRecording=duration=0,filename=/tmp/flight.jfr,settings=profile \
  -jar bff.jar
```

### 공정한 비교를 위한 원칙

| 항목 | 규칙 |
|------|------|
| Heap size | **동일** (`-Xms512m -Xmx512m`). 실제 값은 운영과 맞춤 |
| GC | **동일** (G1) |
| MaxGCPauseMillis | **동일** (200ms) |
| Pod 리소스 | **동일** (CPU/Memory request/limit) |
| JFR | 양쪽 다 켜거나 양쪽 다 끄기 (오버헤드 동일 조건) |

> heap, GC, pod 스펙이 다르면 비교가 무의미. 반드시 동일하게 맞추고, **차이는 Java 버전 + VT + R4j만** 남겨야 한다.

---

## 성능 튜닝 후보 (테스트 후 조정)

기본 비교가 끝난 후, Java 25 이미지에서 추가로 시도해볼 만한 튜닝:

| 튜닝 | 옵션 | 기대 효과 | 리스크 |
|------|------|----------|--------|
| String 중복 제거 | `-XX:+UseStringDeduplication` | JSON 많으면 힙 절약 | GC 오버헤드 소폭 증가 |
| 유휴 시 메모리 반환 | `-XX:G1PeriodicGCInterval=15000` | 유휴 시 pod 메모리 반환 | GC 발생 빈도 증가 |
| Heap pre-touch | `-XX:+AlwaysPreTouch` | 런타임 page fault 감소 | 기동 시간 증가 |
| 큰 페이지 | `-XX:+UseLargePages` | TLB miss 감소 | 노드 설정 필요 (hugepages) |
| Metaspace 제한 | `-XX:MaxMetaspaceSize=256m` | OOM 방지 | 너무 작으면 class loading 실패 |

> 이것들은 **기본 A/B 비교 이후**에 Java 25 이미지에서만 하나씩 켜보면서 효과를 확인한다. 한번에 여러 개 바꾸면 뭐가 효과인지 알 수 없다.
