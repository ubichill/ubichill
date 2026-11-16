---
"@ubichill/cli": patch
"@ubichill/backend": patch
---

`ubichill publish <mods> --check-public` は、出力の一覧（`index.json`）に載っている mod だけを確かめてユーザーページに登録し、載っていない mod の登録を消す（配布物は残す）。登録の取り消し（`DELETE /api/v1/users/me/external-works`）は、登録と同じく CI の API トークンでもできる。
