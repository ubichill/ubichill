---
"@ubichill/shared": minor
"@ubichill/sdk": minor
"@ubichill/ui-renderer": minor
"@ubichill/loader": patch
---

スマホで「どこを押しても長押し判定でバイブレーションが起きる」のを修正した。ハプティクスは
コンテキストメニューではなく「長押しでテキスト選択を開始する」ジェスチャに紐づいているため、
contextmenu の抑止だけでは止まらない。mod 描画面 (ワールド + 画面固定 HUD) で選択自体を
無効化した(テキスト入力欄は編集・貼り付けのため除外)。

`overlay: 'fill'` を追加した。画面全体を覆う HUD レイヤーになり、transform の x/y/w/h ではなく
mod 側の絶対配置で好きな場所へ置ける(「左下にスティック・右下にボタン」のような 1 Component で
複数箇所への配置)。Component の w/h は Entity 側を継承するため、サイズの有無から暗黙に
判定するのではなく明示指定にしている。

mod UI のポインタイベント (`onUbiPointerDown` / `Move` / `Up`) の detail に、要素のローカル座標と
要素サイズを追加した (`UiPointerActionDetail`)。要素の画面上の位置やビューポートサイズを mod が
知らなくても、要素内の相対位置だけで仮想スティックのようなドラッグ操作を実装できる。
