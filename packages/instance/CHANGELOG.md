# @ubichill/instance

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
