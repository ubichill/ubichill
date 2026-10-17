package coord

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"time"
)

// Assignment は部屋の owner のリース。Epoch は owner が交代するたびに増え、Token を持つ owner だけが延長・解放できる。
// Gen は割り当てた時点のクラスタの世代。比べるときは (Gen, Epoch) の組で比べる。
type Assignment struct {
	Node  string
	Epoch int64
	Token string
	Gen   string
}

type NodeState string

const (
	NodeReady    NodeState = "ready"
	NodeDraining NodeState = "draining"
)

// NodeInfo は heartbeat で書くノードの状態。backend が新しい部屋の置き場所を選ぶ（state が ready で空きのあるノード）。
// Connections は部屋の参加者の接続に、ほかの Pod の部屋へ中継している接続を足したもの（どちらもこの Pod の負荷）。
type NodeInfo struct {
	Addr        string    `json:"addr"`
	StartedAt   int64     `json:"startedAt"`
	State       NodeState `json:"state"`
	Rooms       int       `json:"rooms"`
	Connections int       `json:"connections"`
	// Capacity はこのノードが持てる部屋の数の上限。
	Capacity int `json:"capacity"`
}

// RoomPresence は表示用の在席の近似値。入室の許可と定員の判定は owner が行う。
type RoomPresence struct {
	Gen        string   `json:"gen,omitempty"`
	Epoch      int64    `json:"epoch,omitempty"`
	Room       string   `json:"-"`
	Members    []string `json:"members"`
	EmptySince int64    `json:"emptySince"`
}

// Directory は部屋 ID → owner の割り当て、ノードの生存、クラスタの世代、在席を持つ。
type Directory interface {
	// ClusterGen は今のクラスタの世代を返す。無ければ乱数で作る（Redis が全部消えると変わる）。
	ClusterGen(ctx context.Context) (string, error)
	Heartbeat(ctx context.Context, node string, info NodeInfo, ttl time.Duration) error
	Node(ctx context.Context, node string) (NodeInfo, bool, error)
	// Assign は部屋に owner が居なければ node を owner にして epoch を 1 増やし、created=true で返す。
	// 居れば今の割り当てを created=false で返す。gen が今のクラスタの世代と違えば ErrGenChanged、
	// 閉じてから ttl の間（Retire）は ErrRetired。
	Assign(ctx context.Context, room, node, gen string, ttl time.Duration) (a Assignment, created bool, err error)
	Owner(ctx context.Context, room string) (Assignment, bool, error)
	// Renew・Release は token が今の owner と一致するときだけ効く。
	Renew(ctx context.Context, room, token string, ttl time.Duration) (bool, error)
	Release(ctx context.Context, room, token string) (bool, error)
	PublishPresence(ctx context.Context, rooms []RoomPresence, ttl time.Duration) error
	Presence(ctx context.Context, room string) (RoomPresence, bool, error)
	Rooms(ctx context.Context) ([]string, error)
	// Forget は部屋を意図して終えたときに在席と一覧から消す。
	Forget(ctx context.Context, room string) error
	// Retire は owner の token の照合、閉鎖の印、割り当て・在席の削除を原子的に行う。
	// token が空なら owner がいない場合だけ成功する。別の owner が取得済みなら false。
	Retire(ctx context.Context, room, token string, ttl time.Duration) (bool, error)
}

var (
	ErrGenChanged = errors.New("directory: cluster generation changed")
	ErrRetired    = errors.New("directory: room has been closed recently")
	// "epoch:" で始まる ID は ubi:room:epoch:<id> と ubi:room:<id> のキーがぶつかるので受け付けない。
	ErrInvalidRoom = errors.New("directory: room must be non-empty and must not start with \"epoch:\"")
)

// epochRetention は部屋の epoch を最後の延長から残す期間。チケットの最長の期限（ゲストの 24 時間）より長くし、
// 同じ部屋 ID が作り直されて epoch が 1 から数え直されても、前の部屋のチケットが通らないようにする。
const epochRetention = 25 * time.Hour

func validateRoom(room string, ttl time.Duration, checkTTL bool) error {
	if room == "" || strings.HasPrefix(room, "epoch:") {
		return ErrInvalidRoom
	}
	if checkTTL && ttl < time.Millisecond {
		return ErrInvalidLease
	}
	return nil
}

// NewNodeID は Pod 名（無ければホスト名）に起動ごとの乱数を足す。再起動した Pod を別のノードとして扱うため。
func NewNodeID(podName string) string {
	if podName == "" {
		podName, _ = os.Hostname()
	}
	if podName == "" {
		podName = "instance"
	}
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return podName + "-" + hex.EncodeToString(b)
}
