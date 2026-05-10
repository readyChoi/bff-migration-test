# ─────────────────────────────────────────────
# Stage 1: Build (Go static binary)
# ─────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /build
COPY main.go .

# go.mod 자동 생성 (단일 파일, 표준 라이브러리만 사용)
RUN go mod init mock-downstream

# CGO_ENABLED=0 → libc 의존성 제거 (distroless static 이미지에서 동작)
# -trimpath → 빌드 경로 정보 제거 (재현 가능 빌드)
# -ldflags="-s -w" → 디버그 심볼 제거 (바이너리 크기 ~30% 감소)
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/mock-downstream main.go

# ─────────────────────────────────────────────
# Stage 2: Minimal runtime (distroless static, ~2MB)
# ─────────────────────────────────────────────
# distroless/static-debian12 사용 이유:
#   - 셸 없음, 패키지 매니저 없음 → 공격 표면 최소화
#   - libc 없음 (정적 바이너리만 동작)
#   - nonroot 변형은 UID 65532로 실행되지만, OKD는 SCC가 임의 UID 강제 →
#     binary는 UID 무관하게 동작해야 함 (정적 바이너리는 /etc/passwd 룩업 안 함 → OK)
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/mock-downstream /usr/local/bin/mock-downstream

EXPOSE 8080

# nonroot user (USER directive). OKD는 SCC가 이를 override 하지만 명시는 좋은 관행
USER nonroot:nonroot

ENTRYPOINT ["/usr/local/bin/mock-downstream"]
