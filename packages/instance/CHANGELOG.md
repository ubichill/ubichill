# @ubichill/instance

## 1.5.0

### Minor Changes

- 6b10cf8: 部屋へのポータルを、部屋のいちばん前に置く。インスタンスは `portal:open` で作る `core:portal` の z を、ワールドの座標の Entity の z のいちばん大きいものの 1 つ上（整数）にする（画面に固定する `overlay` の Entity と、置き直しで消す自分の前のポータルは比べない。0 より下にはしない（負の z はワールドの背景より奥に描かれる）、transform の上限 1e7 を超えるなら 1e7）。弾幕の範囲（z: 5000）のようにワールドを覆う Entity の上にも出る。画面は置く場所を選ばせてから `portal:open` を送る（shared の `portal:open`・`roomPortalCenter` の説明を合わせた）。
- dccca47: 部屋にいる人が、どのワールドの部屋でも、ほかの部屋へのポータルを開けるようにする。行き先はワールドではなく部屋なので、後から通った人も同じ部屋に入る。インスタンスは `portal:open` を受けると `core:portal` の Entity（data は `room`・`expiresAt`・`ownerName`）を作って全員に配り、60 秒で消す（1 人 1 つ・置き直しは 3 秒あける・1 部屋 64 まで・置いた人が部屋を出ても消さない）。閉じられるのは置いた人だけ（`portal:close`）。数字は shared の `ROOM_PORTAL`。インスタンスの作成に `holdEmptyMs` を足し、ポータルの先に作った部屋は `held_until`（マイグレーション 0046）まで空でも消さない。
- 1b1d1d1: mod を書かずに置ける動きの部品を足す: 最初の場所（`core:spawn`。部屋に入ったとき画面の中心に来る）、ワープ（`core:warp`。押すとワールドの中の別の Entity へスクロールする）、スイッチ（`core:switch`。押すと対象の Entity の見える・見えないを部屋の全員の画面で切り替える）。Entity に `visible`（`false` なら最初は見えない。子も）を足す。インスタンスは見えない Entity の一覧をスナップショットの `hiddenEntities` に持ち、`switch:press` を確かめてから切り替えて `entity:visibility` で配る。公式ワールド（弾幕）の mod danmaku を 1.0.6 に上げる（mod に埋め込まれる部品の一覧が増えたため）。
- 15373c5: ワールドの公開範囲をサーバーの側で守る。プライベートのワールドの部屋を作れるのは作者だけで、作者のサーバーでだけ。

  - ワールドのファイル（`.yaml`・`.lock.json`・`.sig.json`）に公開範囲のヘッダー `Ubichill-World-Visibility: private|public` を付ける（`Access-Control-Expose-Headers` にも入れる）。ほかのサーバーは外部のワールドを解決するとき、`private` ならそのワールドの部屋をだれにも作らせず、一覧・ワールドに置くポータルの行き先からも外す（shared の `WORLD_VISIBILITY_HEADER`・`worldVisibilityFromHeader`）。ファイルは今までどおり誰にでも配る。
  - 部屋へのポータルを置く許可を backend が出す（`POST /api/v1/room-portals/grants`）。プライベートのワールドの部屋へは、その部屋を作った人にだけ出す（いまの公開範囲で判定する）。インスタンスは管理トークンのある運用で `portal:open` の `grant`（`base64url(JSON {room, userId, exp})` + `.` + HMAC-SHA256。鍵は管理トークンから `ubichill room portal grant v1` で派生、60 秒）を確かめ、無い・合わなければ断る。単体モードでは求めない（shared の `ROOM_PORTAL_GRANT`）。

## 1.4.1

## 1.4.0

## 1.3.0

### Minor Changes

- 72b1f61: 満員の部屋の扱いを変えた。

  - 満員の部屋も一覧・フレンドの現在地に出し、画面では「満員」として「入る」を押せなくする（部屋の作成者を除く）。
  - 部屋の作成者は満員でも入れる。Go の管理 API のチケットに `leader` を足し、そのチケットは定員を 1 人まで超えて入れる（引っ越しの受け入れも定員 +1 人まで）。backend は満員の部屋に作成者が入るときだけ `leader` を付ける。
  - 満員の部屋への招待（`'full'`）とリクエストインバイト（`'full'`）を断る。リクエストインバイトで満員を理由にするのは、相手が場所を見せていて、頼む人にその部屋が見えるときだけ（ほかは届けて、答えるときに満員で断る）。
  - shared: `InstanceAudience` に `maxUsers` を足し、`blockedByCapacity`・`isFullFor` を足した。`ListInstancesQuerySchema` から `includeFull` を外した。
  - db: `instanceRepository.findAll` から `includeFull` を外した（DB の status では絞らない）。

## 1.2.1

## 1.2.0

### Minor Changes

- 6ba0785: ほかの ubichill のサーバーの画面から来る来訪者（連合）を入れる。`--federated-visits`（環境変数 `INSTANCE_FEDERATED_VISITS`、既定 true）で、
  自分の画面でない origin からの WebSocket を受け、その origin に結び付いたチケット（管理 API の `origin`）でだけ入室させる。
  自分の画面の origin の接続には、これまでどおり origin の無いチケットを求める（チケットを別の画面で使わせない）。

## 1.1.1

## 1.1.0

### Minor Changes

- 4b24568: インスタンスサーバーのログを `log/slog` の構造化ログにする。`--log-format=auto|text|json`（環境変数 `INSTANCE_LOG_FORMAT`）と `--log-level=debug|info|warn|error`（`INSTANCE_LOG_LEVEL`、既定 `info`）を足す（フラグが優先）。`auto`（既定）は stderr が端末なら色付きの 1 行（`NO_COLOR` で色を消す）、そうでなければ 1 行 1 つの JSON（`time`・`level`・`msg` と属性）を書く。`json` のときは起動の失敗も JSON で書き、stderr に JSON でない行を混ぜない。stdout には書かない。端末でないところ（Kubernetes など）では、既定の出力が今までの 1 行のテキストから JSON に変わる。

### Patch Changes

- b3a5875: npm に入れたインスタンスの起動を確かめるテストが、Windows で予約されたポートを選んで落ちることがあったのを直す（配布するバイナリは変わらない）。

## 1.0.1

## 1.0.0

### Major Changes

- 24578ca: Go のインスタンスサーバー（`ubichill-instance`）を npm のプラットフォーム別パッケージ `@ubichill/instance-<os>-<cpu>` で配り、`@ubichill/cli` の optionalDependencies に入れる（macOS arm64/x64・Linux x64/arm64・Windows x64）。
