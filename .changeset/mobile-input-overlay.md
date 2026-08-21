---
"@ubichill/shared": minor
"@ubichill/sdk": minor
"@ubichill/loader": patch
"@ubichill/backend": patch
"@ubichill/ui-renderer": patch
---

入力パイプラインを PointerEvent 化し、`pointerType`(mouse/pen/touch)を各入力イベントに、
`Ubi.hasCoarsePointer`(タッチ/ペン等の低精度ポインタが使えるか)を mod へ公開した。
これにより mod はキーボード専用の操作をタッチ環境向けに出し分けられるようになる。

`ComponentConfig.overlay` / `EntityComponentSchema.overlay` を追加し、Component を
ワールドスクロールに影響されない画面固定オーバーレイ(HUD)として描画できるようにした。
`overlay` は Component 追加時の既定値としてのみ使い、以降は World Editor の Inspector で
Entity ごとに ON/OFF を切り替えられる。x/y が負値の場合は画面右端/下端からの距離として
解釈され、ビューポートサイズに依存しない配置ができる。

タッチ環境向けの仮想パッド mod `mobile-controller` を追加し、`worlds/danmaku.yaml` に
組み込んだ(mod自体は pnpm workspace 対象外のため changeset 不要)。
