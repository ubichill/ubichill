# @ubichill/instance

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
