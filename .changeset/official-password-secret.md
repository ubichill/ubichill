---
'@ubichill/backend': minor
---

公式アカウントのパスワードを Secret（`OFFICIAL_ACCOUNT_PASSWORD`）で管理するようにしました。起動のたびにその値へ合わせ、値が変わったときだけ既存のログインを無効にします。画面からは変更できません。
