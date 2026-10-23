package kube

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestPatchWritesTheAnnotationWithTheServiceAccountToken(t *testing.T) {
	var got struct {
		method, path, auth, kind, body string
	}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got.method, got.path, got.auth, got.kind, got.body = r.Method, r.URL.EscapedPath(), r.Header.Get("Authorization"), r.Header.Get("Content-Type"), string(b)
	}))
	defer api.Close()
	tokens := []string{"first", "rotated"}
	p := &Patcher{Base: api.URL, Namespace: "ns", Pod: "pod-1", Client: api.Client(), Token: func() (string, error) {
		tok := tokens[0]
		tokens = tokens[1:]
		return tok, nil
	}}
	if err := p.Patch(context.Background(), 12); err != nil {
		t.Fatal(err)
	}
	if got.method != "PATCH" || got.path != "/api/v1/namespaces/ns/pods/pod-1" || got.auth != "Bearer first" || got.kind != "application/merge-patch+json" ||
		got.body != `{"metadata":{"annotations":{"controller.kubernetes.io/pod-deletion-cost":"12"}}}` {
		t.Fatalf("request = %+v", got)
	}
	// トークンは書くたびに読み直す（projected のトークンの入れ替わり）
	if err := p.Patch(context.Background(), 0); err != nil || got.auth != "Bearer rotated" {
		t.Fatalf("second patch: %v %s", err, got.auth)
	}
}

func TestPatchReportsRefusals(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "forbidden", 403) }))
	defer api.Close()
	p := &Patcher{Base: api.URL, Namespace: "ns", Pod: "p", Client: api.Client(), Token: func() (string, error) { return "t", nil }}
	if err := p.Patch(context.Background(), 1); err == nil {
		t.Fatal("a 403 was taken as success")
	}
	p.Token = func() (string, error) { return "", errors.New("no token") }
	if err := p.Patch(context.Background(), 1); err == nil {
		t.Fatal("a missing token was taken as success")
	}
}

func TestThrottleWritesOnlyChangesAtMostEvery30Seconds(t *testing.T) {
	var th throttle
	t0 := time.Unix(1_700_000_000, 0)
	if !th.due(5, t0) {
		t.Fatal("the first value is not written")
	}
	th.wrote(5, t0)
	if th.due(5, t0.Add(time.Hour)) {
		t.Fatal("an unchanged value was written again")
	}
	if th.due(6, t0.Add(29*time.Second)) {
		t.Fatal("a change was written within 30s")
	}
	if !th.due(6, t0.Add(30*time.Second)) {
		t.Fatal("a change was not written after 30s")
	}
	// 失敗したときも間隔を空ける（最初の書き込みの失敗でも）
	var failed throttle
	failed.at = t0
	if failed.due(1, t0.Add(5*time.Second)) || !failed.due(1, t0.Add(30*time.Second)) {
		t.Fatal("a failed write was retried without waiting")
	}
}

func TestWarningsAreSuppressed(t *testing.T) {
	var w warnings
	t0 := time.Unix(1_700_000_000, 0)
	w.warn(errors.New("x"), t0)
	first := w.at
	w.warn(errors.New("x"), t0.Add(time.Minute))
	if w.at != first {
		t.Fatal("a second warning within 10 minutes was logged")
	}
	w.warn(errors.New("x"), t0.Add(warningInterval))
	if w.at == first {
		t.Fatal("the warning was never repeated")
	}
}

func TestInClusterNeedsThePodIdentity(t *testing.T) {
	t.Setenv("KUBERNETES_SERVICE_HOST", "")
	if _, err := InCluster("ns", "pod"); err == nil {
		t.Fatal("outside a cluster")
	}
}

func TestRunWritesOnceForAStableValueAndStopsWithTheContext(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		calls++
		mu.Unlock()
	}))
	defer api.Close()
	p := &Patcher{Base: api.URL, Namespace: "ns", Pod: "p", Client: api.Client(), Token: func() (string, error) { return "t", nil }}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	Run(ctx, p, func() int { return 3 }, time.Now)
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("calls = %d", calls)
	}
}
