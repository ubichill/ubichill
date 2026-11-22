---
"@ubichill/cli": patch
---

`ubichill dev` の world.html で、mod を自分のサーバーの `/mods` から読むとき `Ubi.assets` が `ASSET_INVALID_PATH` で失敗していたのを直す。部屋の読み込み画面に、行き先のワールドのサムネイルを先に出す。
