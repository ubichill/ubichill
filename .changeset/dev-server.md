---
"@ubichill/cli": minor
---

`ubichill dev`: 手元の mod を本番と同じ Go のインスタンスサーバーと `world.html` で動かす開発サーバー。Docker・DB・Go のツールチェーンは要らない。保存すると世代（lock・manifest・Worker・asset）を切り替えてページを読み直し、ビルドに失敗したら前の世代が動き続ける。
