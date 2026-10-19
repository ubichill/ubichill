# @ubichill/e2e

プレビュー環境（`https://pr-<番号>.ubichill.com`）とローカルの `pnpm dev` に対するスモークテスト。2 段ある。

| 段 | 中身 | 目安 |
|---|---|---|
| API と WebSocket（`--suite=api`） | 2 人が登録・ログイン → ワールドの一覧に `default` がある → インスタンスを作る → 2 人が `world:join` して `world:snapshot` を受け取る → `cursor:move` が相手に `cursor:moved` で届く（双方向）→ 共有状態（`state:update` → 相手に `state:changed`、`state:get`、古い revision の書き込みが競合になる）→ インスタンスを消す | 数秒 |
| ブラウザ（`--suite=browser`、Playwright の chromium） | ログイン画面から登録・ログイン → ロビーの「ワールド」に `default` のカードが出る → インスタンスを作って入る（署名の無いワールドの確認を通す）→ pen の Worker が初期化を終え、描画する → mod の検証（lock・作者署名）・Worker のエラー・捕まえられなかった例外がコンソールに出ていない | 10〜30 秒 |

## 走らせ方

```sh
# プレビュー（本番 ubichill.com には走らせない。登録にメール確認が要り、テストのデータが残るため断る）
mise exec -- pnpm smoke https://pr-123.ubichill.com

# ローカルの pnpm dev（画面 :3000・API :3001。localhost の画面なら API は :3001 とみなす）
mise exec -- pnpm smoke http://localhost:3000

# 画面と API のポートが違うとき・片方だけ走らせるとき
mise exec -- pnpm smoke http://localhost:3200 --api=http://localhost:3201 --suite=api
```

初めてブラウザの段を走らせる前に `mise exec -- pnpm --filter @ubichill/e2e exec playwright install --only-shell chromium` を走らせる。

| 引数 | 既定 | 意味 |
|---|---|---|
| `--suite` | `all` | `api`・`browser`・`all` |
| `--world` | `default` | 入るワールドの ID |
| `--api` | 画面と同じ（localhost は :3001） | API（backend）の URL |
| `--report` | なし | 結果の JSON（CI はこれをプレビューのコメントに載せる） |
| `--artifacts` | `packages/e2e/smoke-results` | スクリーンショット・トレース・コンソールのログ |

相手の環境に要るもの: `SKIP_EMAIL_VERIFICATION=true`（登録が即時）、`WORLDS_SERVE_UNSIGNED_REPOSITORY=true`（同梱ワールドに入れる）、`VITE_ENVIRONMENT=development`（未署名の自オリジンの mod を動かせる）。プレビューとローカルの `pnpm dev` はどれも満たす。

## 後片付け

作ったインスタンスは最後に消す（途中で落ちても消す）。アカウントは消さない（プレビューは DB ごと消える）。ID・表示名・メールアドレスはどれも `smoke` で始まり、走りごとの ID（`smoke_<run>_a` など）が付く。

## CI

`ci.yml` の `preview-status` が、プレビューが PR の head のコミットで応答するのを待ってから走らせ、結果をプレビューのコメントの「スモーク（API）」「スモーク（ブラウザ）」の行に載せる。今は情報だけで、落ちてもマージは止めない（`continue-on-error`）。落ちたときはスクリーンショット・トレース・コンソールのログを成果物 `smoke-results` に残す。

CI で増える時間の目安（プレビューの立ち上がりを待つ時間は別）: 依存の導入 30〜60 秒、chromium の headless shell と OS の依存の導入 30〜90 秒（ブラウザはキャッシュする）、スモーク本体 30 秒前後。合わせて 2〜4 分。
