---
"@ubichill/shared": minor
"@ubichill/cli": minor
"@ubichill/backend": minor
---

ワールドの公開（作者の署名付き）にサムネイルを必要にする。World Editor の公開・`ubichill publish`・本体の保存（署名付き）が、サムネイルの無いワールドを断る（下書きと署名の無い保存には求めない。shared の `worldPublishProblem`）。公式ワールド（Ubichill Home・弾幕・WASM デモ）にサムネイルを付ける。入口（`core:portal`）は、行き先のワールドのサムネイルを丸い窓に出し、上に名前を出す。
