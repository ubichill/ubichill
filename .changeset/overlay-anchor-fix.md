---
"@ubichill/shared": minor
"@ubichill/sdk": minor
"@ubichill/loader": patch
"@ubichill/backend": patch
---

画面固定オーバーレイ(`overlay`)が実際には機能していなかったのを修正した。
`worldResolver.ts` の `normalizeEntity` が Component のフィールドを列挙して組み直しており、
スキーマに追加した `overlay` を黙って捨てていたため、YAML に書いても HUD がワールド座標へ
流れていた(World Editor のプレビューでも同じ理由で落ちていた)。正規化はスプレッドで
引き継ぐようにし、この欠落バグのクラスごと回帰テストで固定した。

あわせて `overlay` に画面の角(`top-left`/`top-right`/`bottom-left`/`bottom-right`)を
指定できるようにした。transform.x/y はその角からの距離として解釈されるので、
画面サイズ(縦/横/タブレット)に依存せず HUD が画面内に収まる。`true` は `top-left` と同義。
以前の「x/y が負値なら逆側の端から」という暗黙規約は分かりにくく、意図的に画面外へ
はみ出す配置と区別できなかったため置き換えた。
