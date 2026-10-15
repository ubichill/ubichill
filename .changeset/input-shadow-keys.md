---
"@ubichill/ui-renderer": patch
---

mod の UI の入力欄に打った文字が、ワールドのキー入力としてすべての mod に配られていたのを直した。Shadow DOM の外で受けたキーの打ち先を、付け替え前の要素（`composedPath()` の先頭）で判定する。contenteditable への入力も配らない。
