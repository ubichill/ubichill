---
"@ubichill/backend": minor
"@ubichill/db": minor
"@ubichill/shared": minor
---

ボット対策をコントロールパネルで設定できるようにする。Cloudflare Turnstile か hCaptcha を選び、鍵の組で確かめてから保存する。使うと、メールアドレスとフェディバースでの新規登録で、ボットでないことを確かめる。シークレットキーはサーバーの秘密で暗号化して置く（マイグレーション 0043）。
