FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go build -o mock-downstream main.go

FROM alpine:3.21
COPY --from=builder /app/mock-downstream /usr/local/bin/
EXPOSE 8080
ENTRYPOINT ["mock-downstream"]
