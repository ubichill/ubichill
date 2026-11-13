---
"@ubichill/shared": minor
"@ubichill/cli": patch
"@ubichill/backend": minor
---

エディタで mod の版を常に固定する（`latest` を書かず、既存の `latest` は保存時に lock の版へ固定する）。ワールドに保存した ubichill の版（`spec.requires.protocol`）を書き、より新しい ubichill のワールドを開くときは入る前とエディタで知らせる。Host のイメージは公開済みの mod の版を戻してからビルドし、一度公開した版を配り続ける（`ubichill build` は Host の mods 側の版の履歴も引き継ぐ）。
