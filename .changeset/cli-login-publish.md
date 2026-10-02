---
'@ubichill/sdk': minor
'@ubichill/backend': minor
---

CLI に `login` / `logout` / `whoami` / `publish` / `ci create` を追加しました。`ubichill login` はブラウザで承認してこの端末を公開環境にし（`--device` で別の端末で承認）、`ubichill publish` は mod の固定・作者アカウント付きの署名・公開（本体へ、または `--out` で外部ホスト向けに書き出し）を一度に行います。CI は `ubichill ci create` で作った認証情報を `UBICHILL_CREDENTIALS` に入れて公開できます。
