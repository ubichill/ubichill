---
"@ubichill/cli": minor
"@ubichill/backend": patch
"@ubichill/db": patch
---

端末への出力を作り直す（絵文字をやめ、Vite / Next.js と同じく `✓` 成功・`✗` 失敗・`!` 注意・`➜` 次にすること、TTY のときだけ色。`NO_COLOR` / `FORCE_COLOR` に従う）。

- `ubichill dev`: 起動の途中は mod ごとのビルドの行、起動し終えたら最後に URL の案内（`ready in`）を出す。以降は時刻・`[dev]` / `[build]` / `[instance]`・結果の 1 行。ビルドの失敗は mod の名前と esbuild のコードの抜き出し、ワールドの失敗は直し方を添える。
- `ubichill dev` は既定で手元（127.0.0.1）だけで待ち受ける。`--host`（全部の口）/ `--host=<addr>` で LAN に公開し、そのオリジンを Go にも許す。
- 全体の `--debug`（`UBICHILL_DEBUG=1` と同じ）: 判断・時間・HTTP の要求・Go の info / debug のログを出し、失敗にスタックトレースを付ける。ふだんの失敗はメッセージと直し方だけ。
- `ubichill dev` は Go を `--log-format=json` で起動し、JSON の行を `[instance]` の行にする（ふだんは warn / error だけ）。
- backend・db（migrate）のログは 1 件 1 行（本番は ISO 時刻・level・色なし、スタックの改行は `\n`）。
