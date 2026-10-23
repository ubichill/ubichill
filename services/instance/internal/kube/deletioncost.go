// Package kube は自分の Pod に controller.kubernetes.io/pod-deletion-cost を書く。
// client-go は入れず、in-cluster の ServiceAccount のトークンと CA で Kubernetes API に PATCH する
// （使うのは 1 つの PATCH だけで、client-go は依存を数十倍にする）。
package kube

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	annotation      = "controller.kubernetes.io/pod-deletion-cost"
	serviceAccount  = "/var/run/secrets/kubernetes.io/serviceaccount"
	minInterval     = 30 * time.Second
	checkInterval   = 5 * time.Second
	warningInterval = 10 * time.Minute
)

// Patcher は 1 つの Pod の注釈を書く。
type Patcher struct {
	Base      string
	Namespace string
	Pod       string
	Client    *http.Client
	// Token は書くたびに読む（projected のトークンは期限の前に入れ替わる）。
	Token func() (string, error)
}

// InCluster は Pod の中の設定から Patcher を作る。Pod の外（KUBERNETES_SERVICE_HOST が無い）や名前が無ければ error。
func InCluster(namespace, pod string) (*Patcher, error) {
	host, port := os.Getenv("KUBERNETES_SERVICE_HOST"), os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" || port == "" || namespace == "" || pod == "" {
		return nil, errors.New("pod-deletion-cost needs KUBERNETES_SERVICE_HOST/PORT, POD_NAMESPACE and POD_NAME")
	}
	ca, err := os.ReadFile(serviceAccount + "/ca.crt")
	if err != nil {
		return nil, err
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		return nil, errors.New("pod-deletion-cost: no certificate in the service account CA")
	}
	return &Patcher{
		Base: "https://" + net.JoinHostPort(host, port), Namespace: namespace, Pod: pod,
		Client: &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}}},
		Token: func() (string, error) {
			b, err := os.ReadFile(serviceAccount + "/token")
			return strings.TrimSpace(string(b)), err
		},
	}, nil
}

// Patch は注釈を value にする（merge patch。ほかの注釈は変えない）。
func (p *Patcher) Patch(ctx context.Context, value int) error {
	token, err := p.Token()
	if err != nil {
		return err
	}
	body := fmt.Sprintf(`{"metadata":{"annotations":{%q:%q}}}`, annotation, strconv.Itoa(value))
	u := p.Base + "/api/v1/namespaces/" + url.PathEscape(p.Namespace) + "/pods/" + url.PathEscape(p.Pod)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, u, bytes.NewReader([]byte(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/merge-patch+json")
	res, err := p.Client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("pod-deletion-cost: %s: %s", res.Status, bytes.TrimSpace(msg))
	}
	return nil
}

// throttle は書くかどうかを決める。値が変わったときだけ、前に書いてから minInterval 以上空けて書く。
type throttle struct {
	written bool
	last    int
	at      time.Time
}

func (t *throttle) due(value int, now time.Time) bool {
	return (!t.written || value != t.last) && (t.at.IsZero() || now.Sub(t.at) >= minInterval)
}

func (t *throttle) wrote(value int, now time.Time) { t.written, t.last, t.at = true, value, now }

// warnings は失敗の警告を抑える（最初の 1 回と、そのあと warningInterval ごと）。書けなくても動作は続ける。
type warnings struct{ at time.Time }

func (w *warnings) warn(err error, now time.Time) {
	if w.at.IsZero() || now.Sub(w.at) >= warningInterval {
		log.Printf("could not write the pod deletion cost (continuing without it): %v", err)
		w.at = now
	}
}

// Run は cost を checkInterval ごとに見て、変わっていれば書く。ctx が終わるまで戻らない。
func Run(ctx context.Context, p *Patcher, cost func() int, now func() time.Time) {
	var t throttle
	var w warnings
	tick := time.NewTicker(checkInterval)
	defer tick.Stop()
	for {
		value, at := cost(), now()
		if t.due(value, at) {
			call, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := p.Patch(call, value)
			cancel()
			if err != nil {
				w.warn(err, at)
				// 失敗しても間隔は空ける（API サーバーを叩き続けない）
				t.at = at
			} else {
				t.wrote(value, at)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
