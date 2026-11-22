---
"@ubichill/core-components": minor
"@ubichill/shared": patch
"@ubichill/bff": patch
---

UI（`core:ui`）を、Entity の大きさの四角にする（FigJam の図形と同じ考え方）。塗り（`fill`）・枠線（`border`・`borderWidth`）・角丸（`radius`）・テキスト（`text`・`size`・`color`・`align`・`bold`）を持ち、`button: true` で押せるようになる。押すと、同じ Entity のスクリプト（ワープ `core:warp`・スイッチ `core:switch`・ポータル `core:portal`）を動かす。ワープ・スイッチは並び順に動かし、部屋を出るポータルは並びの最初の 1 つだけを最後に動かす（2 つ目からのポータルは動かず、エディタで知らせる）。スクリプトは、ボタンにした UI があると自分では描かず、無ければ今まで通りの標準のボタンを出す。HTML 風の UI データ（`markup`）は上級者向けとして残す（書くとテキストの代わりに描く）。書いていない項目は描かないので、前の版の `core:ui` の見た目は変わらない。

本体の部品の表示名を、型の名前の読みにそろえる（コライダー・メディア・UI・イメージ・テキスト・ポータル・ワープ・スイッチ・スポーン）。「入口」「最初の場所」「画像」「文字」と呼んでいたものは、YAML の `core:portal` などと対応が分からなかった。ポータルの既定の名前と、公開に要るサムネイルの説明も「ポータル」にする。
