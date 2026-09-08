---
"@ubichill/sdk": minor
---

メディア API に `MediaSource`、`MediaState`、構造化 `MediaError`、`loadId` を追加し、
`Ubi.media.load({ source, ... })` と `Ubi.media.getState()` を公開した。Host は単一の状態機械から
`media:stateChange` を通知し、shared 再生では Server 時刻と revision を持つ正規タイムラインを使う。

従来の位置引数 `load(url, ...)`、個別 media event、peer relay API は deprecated として互換維持する。
