---
"@ubichill/backend": patch
"@ubichill/bff": patch
"@ubichill/cli": patch
"@ubichill/e2e": patch
"@ubichill/shared": patch
---

画面・エラー・`ubichill dev` の出力・文書で「部屋」と「インスタンス」が混ざっていたのを「インスタンス」にそろえる（型の `Instance` の読み）。入れないインスタンスの呼び方は「プライベートインスタンス」にそろえる。用語集 `GLOSSARY.md` を足す。連合のプロトコルの `rooms`・部屋の住所の形は変えない。
