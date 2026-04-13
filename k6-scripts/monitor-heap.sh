#!/bin/bash
# BFF pod의 힙/GC/스레드 상태를 주기적으로 기록
#
# 사용법:
#   ./monitor-heap.sh                          # 기본: 30초 간격, 2시간
#   ./monitor-heap.sh 10 3600                  # 10초 간격, 1시간
#   NAMESPACE=test POD=bff-xxx ./monitor-heap.sh
#
# 출력: results/heap-monitor-YYYYMMDD-HHMM.csv

INTERVAL=${1:-30}          # 수집 간격 (초)
DURATION=${2:-7200}        # 총 수집 시간 (초, 기본 2시간)
NAMESPACE=${NAMESPACE:-test}
POD=${POD:-$(kubectl get pod -n $NAMESPACE -l app=bff -o jsonpath='{.items[0].metadata.name}')}

RESULTS_DIR="./results"
mkdir -p "$RESULTS_DIR"
OUTFILE="$RESULTS_DIR/heap-monitor-$(date +%Y%m%d-%H%M).csv"

echo "timestamp,heap_used_mb,heap_max_mb,heap_usage_pct,gc_count,gc_time_ms,thread_count,thread_peak" > "$OUTFILE"
echo "Monitoring $POD in $NAMESPACE every ${INTERVAL}s for ${DURATION}s"
echo "Output: $OUTFILE"

END_TIME=$(($(date +%s) + DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
  TIMESTAMP=$(date +%Y-%m-%dT%H:%M:%S)

  # Actuator로 수집 (Spring Boot Actuator가 켜져 있는 경우)
  METRICS=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
    curl -s http://localhost:8080/actuator/metrics 2>/dev/null)

  if [ $? -eq 0 ] && [ -n "$METRICS" ]; then
    # Actuator metrics 개별 조회
    HEAP_USED=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      curl -s http://localhost:8080/actuator/metrics/jvm.memory.used?tag=area:heap 2>/dev/null \
      | grep -o '"value":[0-9.]*' | head -1 | cut -d: -f2)
    HEAP_MAX=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      curl -s http://localhost:8080/actuator/metrics/jvm.memory.max?tag=area:heap 2>/dev/null \
      | grep -o '"value":[0-9.]*' | head -1 | cut -d: -f2)
    GC_COUNT=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      curl -s http://localhost:8080/actuator/metrics/jvm.gc.pause 2>/dev/null \
      | grep -o '"count":[0-9]*' | head -1 | cut -d: -f2)
    GC_TIME=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      curl -s http://localhost:8080/actuator/metrics/jvm.gc.pause 2>/dev/null \
      | grep -o '"totalTime":[0-9.]*' | head -1 | cut -d: -f2)
    THREADS=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      curl -s http://localhost:8080/actuator/metrics/jvm.threads.live 2>/dev/null \
      | grep -o '"value":[0-9.]*' | head -1 | cut -d: -f2)
    THREADS_PEAK=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      curl -s http://localhost:8080/actuator/metrics/jvm.threads.peak 2>/dev/null \
      | grep -o '"value":[0-9.]*' | head -1 | cut -d: -f2)

    # bytes → MB 변환
    HEAP_USED_MB=$(echo "scale=1; ${HEAP_USED:-0} / 1048576" | bc 2>/dev/null || echo "0")
    HEAP_MAX_MB=$(echo "scale=1; ${HEAP_MAX:-0} / 1048576" | bc 2>/dev/null || echo "0")
    HEAP_PCT=$(echo "scale=1; ${HEAP_USED:-0} * 100 / ${HEAP_MAX:-1}" | bc 2>/dev/null || echo "0")
    GC_TIME_MS=$(echo "scale=0; ${GC_TIME:-0} * 1000" | bc 2>/dev/null || echo "0")

    echo "$TIMESTAMP,$HEAP_USED_MB,$HEAP_MAX_MB,$HEAP_PCT,${GC_COUNT:-0},$GC_TIME_MS,${THREADS:-0},${THREADS_PEAK:-0}" >> "$OUTFILE"
    echo "[$TIMESTAMP] heap=${HEAP_USED_MB}MB/${HEAP_MAX_MB}MB (${HEAP_PCT}%) gc=${GC_COUNT:-0} threads=${THREADS:-0}"
  else
    # Actuator 없으면 jstat 사용
    JSTAT=$(kubectl exec -n "$NAMESPACE" "$POD" -c bff -- \
      jstat -gc 1 2>/dev/null | tail -1)

    if [ -n "$JSTAT" ]; then
      echo "[$TIMESTAMP] jstat: $JSTAT"
      echo "$TIMESTAMP,jstat,$JSTAT" >> "$OUTFILE"
    else
      echo "[$TIMESTAMP] Failed to collect metrics"
    fi
  fi

  sleep "$INTERVAL"
done

echo "Done. Results: $OUTFILE"
