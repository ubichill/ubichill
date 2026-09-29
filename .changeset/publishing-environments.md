---
'@ubichill/backend': minor
---

作者アカウントが公開環境（ブラウザ・CLI・CI）ごとに署名鍵を持てるようにし、取り消せるようにしました。取り消した鍵の署名は取り消し前のものも作者が外れます。鍵一覧は WebFinger の links から辿る `/api/v1/authors/:handle/signing-keys` で公開し、旧 `ed25519-signing-key` プロパティは削除しました。Web では「公開する」でこのブラウザの鍵を自動で作成・登録します。
