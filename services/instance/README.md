# Goインスタンスサーバー

インスタンス内の入退室・カーソル・エンティティ・ロック・メディア同期を管理する。
SNSアカウント、Better Auth、PostgreSQL、Redis、Node.jsに依存せず起動できる（Redisは任意。下の「環境変数」）。
modの実行はブラウザ内のWorkerで行う。

## 単体運用

リポジトリのルートから:

```sh
go -C services/instance run ./cmd/instance \
  --guests --world=examples/empty.json --origins=http://localhost:3000
```

別ターミナルで既存のブラウザUIを起動する（事前に `pnpm install` と `pnpm turbo build --filter=@ubichill/shared`）:

```sh
VITE_INSTANCE_SERVER_URL=http://localhost:3002 pnpm --filter @ubichill/frontend dev
```

`http://localhost:3000/instance/standalone?name=Alice` を開く。ログイン不要で、他のブラウザから入った
ゲストのカーソルが見える。ゲストIDはサーバーが発行し、同じタブでの再接続に保持する。
`VITE_INSTANCE_ID` でルートURLから移動するインスタンスIDを変更できる。
表示用UIとmod配信はフロント側が担当する。
GoサーバーはUIの静的ファイルやmodを配信しない。フロントをビルドして任意の静的ホストから配信すれば、
実行時に必要なバックエンドはGoのみになる。開発用のViteサーバーもSNS backendには依存しない。

`--world` はOpenAPIの `InstanceDefinition` 形式のJSON。初期エンティティはflatten済みの
ComponentInstance配列で、mod完全性lockや環境設定も含む。
既存のWorld as Code YAMLを使うSNS運用では、TypeScript側の既存の検証・解決・flattenを利用する。
単体運用でmodを使う場合は `pnpm build:workers` でフロントの配信物を作り、定義にlockと初期状態を渡す。

Goバイナリだけを配布する場合:

```sh
go -C services/instance build -o ../../dist/ubichill-instance ./cmd/instance
```

Docker（リポジトリルートから）:

```sh
docker build -t ubichill-instance services/instance
docker run --rm -p 3002:3002 \
  -v "$PWD/services/instance/examples:/worlds:ro" ubichill-instance \
  --guests --world=/worlds/empty.json --origins=http://localhost:3000
```

## SNS連携

`pnpm dev` はGoも起動し、その開発セッション用の管理トークンを双方に渡す。
手動起動では、32文字以上のランダムな `INSTANCE_ADMIN_TOKEN` を双方に同じ値で設定する。

- Go: `go -C services/instance run ./cmd/instance --origins=http://localhost:3000`
- SNS: `INSTANCE_RUNTIME_URL=http://127.0.0.1:3002`（管理APIの内部到達先）
- SNS: `INSTANCE_PUBLIC_URL=http://localhost:3002/realtime/v1/ws`（ブラウザの接続先）

SNSが入室条件を検証して初期状態をPUTし、参加チケットを発行する。
フロントは `POST /api/v1/instances/:id/join` でチケットを取得し、Goへ直接接続する。
人数・在席・フレンドの現在地はGoの管理APIから取得する。Goに到達できなければエラーにし、
空室と見なしてDBレコードを削除しない。空室回収はGo側でも在席を再確認してから実行する。
SNS連携では在席0になってから5秒の猶予を置き、1秒ごとに回収を確認する（通常5〜6秒）。
`INSTANCE_EMPTY_TIMEOUT_MS` / `INSTANCE_REAP_INTERVAL_MS` で変更できる。
Go再起動で部屋が消えた場合は別の `INSTANCE_RECOVERY_GRACE_MS`（既定60秒）で再接続を待つ。
通信切断後の15秒の参加者保持は独立した設定で、明示退出では即座に在席から外れる。

Helmでは専用イメージ（`ghcr.io/ubichill/ubichill-instance`）・Deployment/ServiceでGoを配置し、
WebSocketの `/realtime/v1/ws` だけを直接ルーティングする（管理APIはクラスタ内のみ）。
backendのデプロイや設定変更ではGoを再起動しない（状態がメモリにあるため）。
管理トークンは既定でbackend Secretの `BETTER_AUTH_SECRET` キーを参照する。
専用キーを使う場合は `instanceRuntime.existingSecret` / `instanceRuntime.secretKey` を指定する。
明示したIngressルートに旧 `/socket.io` があれば削除できる。

## 環境変数

| 名前 | 説明 |
|---|---|
| `INSTANCE_ADMIN_TOKEN` | 管理APIのトークン（32文字以上）。`--guests` 以外では必須 |
| `INSTANCE_TICKET_KEY` | 参加チケットの署名鍵（任意・32文字以上）。無ければ管理トークンから派生し、どちらも無ければ起動ごとの乱数 |
| `REDIS_URL` / `REDIS_PASSWORD` | 任意。Redis の接続先 |
| `INSTANCE_DIRECTORY` | `memory`（既定）/ `redis`。`redis` なら部屋の割り当て（Directory・owner のリースと世代・在席・heartbeat）を Redis で共有し、複数の Pod と WS Router が使える（`REDIS_URL` 必須）。Redis が落ちてもメモリに切り替えず、新しい部屋は作れず、既存の部屋は自己停止する。backend にも同じ値を渡す |
| `POD_NAME` | ノード ID の元（起動ごとの乱数を足す）。無ければホスト名。Helm は Downward API で渡す |
| `POD_NAMESPACE` | `--pod-deletion-cost` で注釈を書く Pod の namespace。Helm は自動スケールが有効なときだけ Downward API で渡す |
| `POD_IP` / `INSTANCE_ADVERTISE_ADDR` | 他の Pod・backend から届く自分のアドレス（`host:port`。heartbeat に書き、中継と管理 API の宛先になる）。`INSTANCE_ADVERTISE_ADDR` が優先、無ければ `POD_IP` かホスト名に待ち受けのポートを付ける |

## 状態と運用上の制約

- 現時点の状態保存はメモリのみ。再起動すると編集状態・在席が失われる（チケットの署名鍵は管理トークンから派生するので、
  再接続情報は再起動の前後で有効なまま。部屋が消えていれば `instance_unavailable` で取り直す）。
  SNS側のDBにあるインスタンスは次の入室時にワールド初期状態から復元する。
- HelmのGo Deploymentは既定で1 replica・Recreate。`INSTANCE_DIRECTORY=redis`（chart: `instanceRuntime.directory: redis`）なら
  `instanceRuntime.replicas` を2以上にでき、更新は RollingUpdate になる（memory のまま2以上にすると描画で失敗する）。設計は docs/design/instance-scaling.md。
- **置き場所**: 各 Pod は heartbeat に `{addr, state, rooms, connections, capacity}` を書き、`ubi:nodes` に自分を載せる。`connections` は部屋の参加者と、
  ほかの Pod の部屋へ中継している接続の合計。`capacity` は `--max-rooms`（既定 1000）。backend は `directory: redis` のとき、
  部屋の owner が生きていればその Pod、居なければ `state: ready` で部屋数が `capacity` 未満の Pod を接続数・部屋数の少ない順に選び、その Pod へ作成を送る。
  draining・上限に達した Pod は作成を 503 で断り、backend は次の Pod へ送り直す。
- **draining**: SIGTERM を受けると、新しい部屋の作成を 503 で断り、heartbeat の `state` を `draining` に書き直し、`GET /ready` を 503 にする（`/health` は 200 のまま）。
  持っている部屋は入室・操作・延長とも続ける。作られてから `--migrate-after`（既定 3h）を過ぎても参加者の居る部屋は、下の「引っ越し」で別の Pod へ移す。
  接続（参加者と中継）が無くなるか `--drain-timeout`（既定 0。chart は redis のとき 24h）を過ぎたら、残りの部屋を閉じて割り当てを解放する
  （`instance:closing` は送らない）。上限の `--disconnect-notice`（既定 10m）前に、直接繋いでいるクライアントへ
  `{"event":"server:notice","data":{"kind":"disconnect","at":<切る時刻の epoch ms>}}` を送る。
- **引っ越し（handoff）**: 元の Pod が部屋を凍結し（変更系の要求は `code: "migrating"` の失敗。状態は変えないので送り直せる。カーソルなど応答の要らないものは捨てる）、
  中身（エンティティと順序・共有状態の値と revision・updatedAt・参加者のプロフィール・定義・作った時刻）を先の Pod の
  `POST /realtime/v1/instances/{id}/handoff`（管理トークン。Pod 間だけ）に `prepare` で渡す。先は ready・空きあり・接続の少ない順に選ぶ。
  元の Pod は Directory の `Transfer`（token が一致すれば node を替え epoch+1。新しい token は先が準備で作ったもの）で付け替え、`commit` で先に確定させる。
  先は自分で延長してから owner になる。確定が届かなくても、先は準備の期限（10 秒）に Directory を引き、自分に付け替わっていれば引き取る（owner の居ない隙間を作らない）。
  確定を断られたら元の Pod が取り戻して凍結を解く。付け替えたか分からないとき（Redis の応答が消えた）は、元の Pod は部屋を手放して接続を閉じる。
  中継されてきた接続には元の Pod が `relay:migrate`（新しい owner の node・addr・gen・epoch）を送り、中継元が新しい owner へ繋ぎ直す。
  チケットは中継元が署名し直し（全 Pod で鍵が同じ）、入室の応答は飲み込み、繋ぎ直しの間にクライアントから来たフレームは 64 件まで持っておいて順に送る（溢れたら切る）。
  元の Pod に直接繋いでいるクライアントは、元の Pod 自身が中継に変わる。`relay:migrate` はクライアントには届かない。
  新しい owner は移ってきた参加者を切断の猶予（`max(--disconnect-grace, 30s)`）の状態で持ち、繋ぎ直しでは `user:joined` を出さない（`users:update`・`world:snapshot` は送り直す）。
- **pod-deletion-cost**: `--pod-deletion-cost` を付けると、自分の Pod に `controller.kubernetes.io/pod-deletion-cost`（直接繋いでいるクライアント数 + owner の部屋の参加者数）を
  変わったときだけ・最短 30 秒おきに書く。client-go は使わず、in-cluster の ServiceAccount のトークンと CA で PATCH する（`POD_NAME`・`POD_NAMESPACE` が要る）。失敗しても動作は続ける。
- **指標**: `GET /metrics`（認証なし。Ingress には出さない）で部屋数・部屋の上限と空き・WebSocket の接続数（中継を含む）・中継の数・draining を
  Prometheus の text 形式で出す。KEDA の scale-out に使う（chart の README の「Go インスタンスの自動スケール（KEDA）」）。
- **閉じた部屋**: 終了した部屋は 2 分間どの Pod でも作り直せない（Directory の `ubi:retired:<id>`。memory なら Pod の中だけ）。割り当ての Lua の中で確かめ、
  閉じる側は token の照合・印の設定・割り当てと在席の削除を原子的に行う。owner が変わっていたら 409、Redis に届かなければ 503 を返し、DB の削除を止める。作成は 400。
- **WS Router**: 各 Pod が Router を兼ねる。最初の `world:join` の部屋が手元に無ければ、Directory の owner の内部アドレス
  （heartbeat の `addr`）の `/realtime/v1/relay` へ WebSocket を張り、`world:join` から先を双方向に中継する。owner は Upgrade の後に1回だけ決め、
  owner が接続を閉じたら（自己停止・終了・退出）中継も閉じる。クライアントはチケットを取り直して繋ぎ直す。
  owner が居ない・heartbeat が切れている・中継先が別のノードだったときは `instance_unavailable`、チケットの世代が今の owner と違えば `ticket_invalid`。
  中継された接続はさらに中継しない。中継している Pod は、止めるときも `--drain-timeout` まで中継を続け、その後に切る。
  owner が引っ越したとき（上の「引っ越し」）だけは、閉じずに新しい owner へ繋ぎ直す。
- **Pod 間の認証**: `/realtime/v1/relay` は Ingress に出さない。さらに中継元は、管理トークンから HMAC-SHA256 で派生した鍵
  （用途の名前 `ubichill instance relay v1`）で `{from, to, exp}` に署名した `X-Ubichill-Relay` ヘッダーを付ける。owner は署名・30秒の期限・
  宛先のノード ID を確かめ、無い・違えば 401、宛先が別のノードなら 421 にする。Origin はブラウザ以外なら自由に付けられるので認証に使わない。
  中継用の口でも owner はチケットと `(gen, epoch)` を自分で確かめる。
- **上限を数える場所**: 毎秒240件のレート制限はクライアントが繋いだ Pod だけが数える（owner でも数えると窓の区切りがずれて二重に絞る）。
  受信70KiBの上限は両方にあるが、中継は同じバイト列を送るので先に効くのは繋いだ Pod。ping/pong とアイドルの切断は区間ごと
  （クライアント ⇔ 繋いだ Pod、繋いだ Pod ⇔ owner）。
- 管理 API（作成・チケット発行・終了）は任意の `?gen=&epoch=` を受け、今の部屋の世代と違えば409（今の owner を付ける）。
  reaper は観測した世代を付け、世代が変わっていれば送り直さない。不在を観測した場合は `?absent=true` で owner がいないことを原子的に確認する。
  Redis の在席にも `gen/epoch` を載せ、owner も在席も期限切れの参照は backend が Redis 内で再確認して `ubi:rooms` から外す。
  backend は `directory: redis` のとき、割り当てた Pod（在席の `addr`、409 の `owner.addr`）の `http://<addr>/realtime/v1` へ続く管理 API を送り、
  在席は Redis の `ubi:rooms`・`ubi:presence:<id>` から読む。
- owner は部屋のリースを 5 秒ごとに延長する。最後に成功した延長の要求を送った時刻から 10 秒（TTL 15 秒 − 余裕 5 秒）を過ぎると、
  その部屋の状態変更と入室を止めて接続を閉じる（`instance:closing` は送らない。クライアントはチケットを取り直して入り直し、
  部屋は新しい epoch で作り直される）。Redis の中身が消えて世代（`ubi:cluster:gen`）が変わったときも全部屋を捨てる。
- プロセスが落ちて割り当てを解放できなかった部屋は、TTL（15 秒）が切れるまで他の Pod が作れない（管理 API は 409。backend の入室は 503 で、
  クライアントは再接続の上限の中で取り直す）。切れたあとの入室で別の Pod が新しい epoch で作り、前のチケットは `ticket_invalid` になる。
  通常の停止（SIGTERM）では解放するので、次の Pod はすぐ作り直せる。
- 同じユーザーの別の接続へ `session:replaced` を送るのは、同じ owner の Pod の部屋どうしだけ。別の Pod の部屋に入り直したときは、
  前の部屋の接続はそのまま残る（閉じれば猶予のあと抜ける）。
- SNS停止中でも既存のGo接続は継続する。SNS連携での新規入室・再接続はチケット再取得が必要。
- 自動再接続は最大6回・30秒。失効チケットの取り直しも同じ上限内で1回だけ行う。
  単体モードは上限到達後に失敗画面に留まり、本人の操作で再試行する。
- SNSのフレンド解除やBANを既存接続へ即時反映する機能はない。
- 公開運用ではTLSをIngress等で終端し、`--origins` を実際のフロントURLへ設定する。

通信・制限・再同期の詳細は [プロトコル](../../protocol/instance/README.md)。

## 開発

```sh
pnpm protocol:generate
go -C services/instance test -race ./...
go -C services/instance vet ./...
```

HTTP型はOpenAPIからGo/TypeScript双方に生成する。WebSocketのイベント型は既存のsharedの型を利用し、
AsyncAPIで接続とフレームを記述する。ドメイン操作・再接続・ロック等は手書き実装。
