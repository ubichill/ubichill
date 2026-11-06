---
"@ubichill/backend": patch
---

undici を 8 に上げる（外部 URL の取得 `safeFetch` の接続時の DNS 検査は、8 でも接続のたびに呼ばれることを確かめた）。
