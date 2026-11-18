---
"@ubichill/cli": patch
---

`ubichill dev` の画面（world.html）で、mod の不正な値 1 つで画面全体が止まらないようにする。

- lock の `capabilities` に `constructor` などがあっても権限の判定が例外にならない
- 型に合わない VNode（`props: null`・数値の `children`・深すぎる入れ子）でも、その mod の UI だけを空にして診断を出す
- 初期化に失敗した Worker が入力のイベントを溜め続けない。後から起動した Worker に過去の入力を渡さない
- Shadow DOM の中の入力欄で、入力中の文字・日本語の変換を古い VNode で戻さない。`textarea`・`select` にも値を入れる
- mod の UI の画像は https（同じオリジンの http）・相対 URL・`data:image/` だけにし、参照元を送らない。`referrerpolicy` は mod に決めさせない
