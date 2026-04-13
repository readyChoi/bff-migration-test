package main

import (
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ── Config ──

type Config struct {
	Delay        string `json:"delay"`          // 응답 지연 (e.g. "100ms", "2s")
	ErrorRate    int    `json:"error_rate"`      // 에러율 (0-100)
	ErrorCode    int    `json:"error_code"`      // 에러 시 HTTP status (default: 500)
	PayloadSize  int    `json:"payload_size"`    // 응답 body 크기 (bytes)
	FailAfter    int64  `json:"fail_after"`      // N번째 요청 이후 실패 (0=미사용)
	ResponseBody string `json:"response_body"`   // 커스텀 응답 JSON (optional)
	ReadBody     bool   `json:"read_body"`       // request body를 끝까지 읽을지 여부
}

// ── Routes (path prefix별 config) ──

type Routes struct {
	mu       sync.RWMutex
	routes   map[string]Config // key: path prefix (e.g. "/slow", "/fast")
	fallback Config            // "_default" 또는 매칭 없을 때
}

// Get은 요청 path에서 가장 길게 매칭되는 prefix의 config를 반환한다.
// 예: routes에 "/slow"가 있으면, "/slow", "/slow/api/test", "/slow/anything" 전부 매칭
func (rt *Routes) Get(path string) Config {
	rt.mu.RLock()
	defer rt.mu.RUnlock()

	if rt.routes == nil {
		return rt.fallback
	}

	// 가장 긴 prefix 매칭
	bestKey := ""
	for key := range rt.routes {
		if strings.HasPrefix(path, key) && len(key) > len(bestKey) {
			bestKey = key
		}
	}

	if bestKey != "" {
		return rt.routes[bestKey]
	}
	return rt.fallback
}

func (rt *Routes) Set(routeMap map[string]Config) {
	rt.mu.Lock()
	defer rt.mu.Unlock()

	rt.routes = make(map[string]Config)
	for k, v := range routeMap {
		if k == "_default" {
			rt.fallback = v
		} else {
			rt.routes[k] = v
		}
	}
}

func (rt *Routes) SetGlobal(cfg Config) {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.routes = nil
	rt.fallback = cfg
}

func (rt *Routes) Reset() {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	rt.routes = nil
	rt.fallback = Config{}
}

func (rt *Routes) Dump() map[string]Config {
	rt.mu.RLock()
	defer rt.mu.RUnlock()
	result := make(map[string]Config)
	for k, v := range rt.routes {
		result[k] = v
	}
	result["_default"] = rt.fallback
	return result
}

// ── Schedule (F-3 시나리오용) ──

type SchedulePhase struct {
	At     string `json:"at"`     // 스케줄 시작으로부터의 시간 (e.g. "0s", "120s")
	Config Config `json:"config"` // 해당 시점에 적용할 global config
}

type Schedule struct {
	Phases []SchedulePhase `json:"phases"`
}

// ── Metrics ──

type Metrics struct {
	TotalRequests  int64 `json:"total_requests"`
	SuccessCount   int64 `json:"success_count"`
	ErrorCount     int64 `json:"error_count"`
	ActiveRequests int64 `json:"active_requests"`
}

// ── Global state ──

var (
	routes         Routes
	counter        atomic.Int64
	successCounter atomic.Int64
	errorCounter   atomic.Int64
	activeRequests atomic.Int64
	scheduleMu     sync.Mutex
	scheduleCancel func()
)

func parseDelay(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0
	}
	return d
}

// ── Path 파라미터 파싱 ──
// /delay/2s/size/1mb/error/50 → Config{Delay:"2s", PayloadSize:1048576, ErrorRate:50}

func parsePathConfig(path string) (Config, bool) {
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 {
		return Config{}, false
	}

	cfg := Config{}
	found := false
	for i := 0; i+1 < len(parts); i += 2 {
		key := parts[i]
		val := parts[i+1]
		switch key {
		case "delay":
			cfg.Delay = val
			found = true
		case "size":
			cfg.PayloadSize = parseSize(val)
			found = true
		case "error":
			n, _ := strconv.Atoi(val)
			cfg.ErrorRate = n
			cfg.ErrorCode = 500
			found = true
		case "errorcode":
			n, _ := strconv.Atoi(val)
			cfg.ErrorCode = n
			found = true
		}
	}
	return cfg, found
}

func parseSize(s string) int {
	s = strings.ToLower(s)
	multiplier := 1
	if strings.HasSuffix(s, "kb") {
		multiplier = 1024
		s = s[:len(s)-2]
	} else if strings.HasSuffix(s, "mb") {
		multiplier = 1024 * 1024
		s = s[:len(s)-2]
	} else if strings.HasSuffix(s, "b") {
		s = s[:len(s)-1]
	}
	n, _ := strconv.Atoi(s)
	return n * multiplier
}

// ── Main handler ──

func handler(w http.ResponseWriter, r *http.Request) {
	activeRequests.Add(1)
	defer activeRequests.Add(-1)

	// 우선순위: path 파라미터 > routes > global config
	cfg, fromPath := parsePathConfig(r.URL.Path)
	if !fromPath {
		cfg = routes.Get(r.URL.Path)
	}
	count := counter.Add(1)

	if cfg.ReadBody {
		io.Copy(io.Discard, r.Body)
	}

	if delay := parseDelay(cfg.Delay); delay > 0 {
		time.Sleep(delay)
	}

	if cfg.FailAfter > 0 && count > cfg.FailAfter {
		errorCounter.Add(1)
		errCode := cfg.ErrorCode
		if errCode == 0 {
			errCode = 500
		}
		w.WriteHeader(errCode)
		json.NewEncoder(w).Encode(map[string]string{"error": "forced failure"})
		return
	}

	if cfg.ErrorRate > 0 && rand.Intn(100) < cfg.ErrorRate {
		errorCounter.Add(1)
		errCode := cfg.ErrorCode
		if errCode == 0 {
			errCode = 500
		}
		w.WriteHeader(errCode)
		json.NewEncoder(w).Encode(map[string]string{"error": "random failure"})
		return
	}

	successCounter.Add(1)
	w.Header().Set("Content-Type", "application/json")

	if cfg.ResponseBody != "" {
		w.Write([]byte(cfg.ResponseBody))
		return
	}

	if cfg.PayloadSize > 0 {
		resp := map[string]interface{}{
			"status": "ok",
			"path":   r.URL.Path,
			"count":  count,
			"data":   strings.Repeat("x", max(0, cfg.PayloadSize-80)),
		}
		json.NewEncoder(w).Encode(resp)
		return
	}

	resp := map[string]interface{}{
		"status": "ok",
		"path":   r.URL.Path,
		"count":  count,
	}
	json.NewEncoder(w).Encode(resp)
}

// ── Config handler (전역 config — 모든 path 동일 동작) ──

func configHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		var cfg Config
		json.NewDecoder(r.Body).Decode(&cfg)
		routes.SetGlobal(cfg)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(cfg)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(routes.Dump())
}

// ── Routes handler (path prefix별 config) ──

func routesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		var routeMap map[string]Config
		if err := json.NewDecoder(r.Body).Decode(&routeMap); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		routes.Set(routeMap)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(routeMap)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(routes.Dump())
}

// ── Schedule handler (시간에 따라 global config 자동 전환) ──

func scheduleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		cancelSchedule()
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"schedule cancelled"}`))
		return
	}

	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var sched Schedule
	if err := json.NewDecoder(r.Body).Decode(&sched); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	cancelSchedule()

	scheduleMu.Lock()
	done := make(chan struct{})
	scheduleCancel = func() {
		select {
		case <-done:
		default:
			close(done)
		}
	}
	scheduleMu.Unlock()

	startTime := time.Now()
	go func() {
		for _, phase := range sched.Phases {
			delay := parseDelay(phase.At)
			waitUntil := startTime.Add(delay)
			remaining := time.Until(waitUntil)
			if remaining > 0 {
				select {
				case <-time.After(remaining):
				case <-done:
					return
				}
			}
			routes.SetGlobal(phase.Config)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sched)
}

func cancelSchedule() {
	scheduleMu.Lock()
	defer scheduleMu.Unlock()
	if scheduleCancel != nil {
		scheduleCancel()
		scheduleCancel = nil
	}
}

// ── Reset handler ──

func resetHandler(w http.ResponseWriter, r *http.Request) {
	cancelSchedule()
	routes.Reset()
	counter.Store(0)
	successCounter.Store(0)
	errorCounter.Store(0)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"reset"}`))
}

// ── Metrics handler ──

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	m := Metrics{
		TotalRequests:  counter.Load(),
		SuccessCount:   successCounter.Load(),
		ErrorCount:     errorCounter.Load(),
		ActiveRequests: activeRequests.Load(),
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m)
}

// ── Main ──

func main() {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"healthy"}`))
	})
	http.HandleFunc("/config", configHandler)
	http.HandleFunc("/config/routes", routesHandler)
	http.HandleFunc("/config/schedule", scheduleHandler)
	http.HandleFunc("/reset", resetHandler)
	http.HandleFunc("/metrics", metricsHandler)
	http.HandleFunc("/", handler)
	http.ListenAndServe(":8080", nil)
}
