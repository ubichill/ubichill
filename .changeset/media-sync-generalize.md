---
"@ubichill/shared": minor
"@ubichill/backend": patch
"@ubichill/sdk": minor
---

メディア同期プロトコルを一般化し、バックグラウンド再生を整備した。

- `media:sync` / `media:state-response` のペイロードを `currentIndex`（動画プレイリスト前提）から `MediaSyncState`（`mediaId` ベース、`duration` / `playbackRate` を任意付加）へ一般化。バックエンドは引き続き中身を解釈しないリレーのみ。
- `Ubi.media.load()` に `kind`（`'audio' | 'video'`）を追加。`'audio'` はデバイス操作（メディアキー/ロック画面）を既定で許可し、`navigator.mediaSession.playbackState` を設定してバックグラウンド再生を継続する。`'video'`（既定）は明示許可までデバイス操作をロックする。
