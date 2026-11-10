---
"@ubichill/backend": patch
"@ubichill/shared": patch
"@ubichill/db": patch
---

backend の構造を整理する（API とレスポンスは変えない）。やり取りを止める判定を shared の interactionRefusal にまとめ、ユーザーを消すとブロックされた側の行も消す。
