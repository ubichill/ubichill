---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/cli": minor
---

Component 同士を、階層の形ではなく**型付きの参照**で配線できるようにした（#191）。

- SDK: `dataFields` の `entityRef` / `entityRefArray` に `component`（参照先が持つべき Component 型）と `required` を足した。`Ubi.event.emit(type, data, { ref: '<フィールド名>' })` で、ワールド作者が指した Entity のその型の Component にだけ届く。`scope: 'referrers'` で、参照で自分を指している Component に返せる。`EmitOptions`（`{ scope, targetType? }`）は interface のまま残し、参照で送るときの `RefEmitOptions`（`{ ref, targetType? }`）を足した。`emit` はどちらか一方を受ける（両方・どちらも無しは型で弾く）。既存の `scope` の意味は変えていない。
- SDK: 古い Host は `ref`・`scope: 'referrers'` をエラーにせず捨てるので、プロトコルの版（`PROTOCOL_VERSION`）を 6 に上げ、`Ubi.runtime.supports('event:ref')`（と `core:media` の描画先の `'media:surface'`）で確かめられるようにした。
- SDK: 参照フィールドの `access` で許す読み書きは、`component` を宣言していれば参照先のその型の Component だけ。`default` は World Editor で Component を足したときに data へ書く初期値で、data に無いときの代わりにはならない。
- shared: 参照の解決と検査（`resolveRefs`・`findReferenceProblems`・`describeReferenceProblem`）。World Editor・`ubichill dev`・Host の配送が同じ判定を使う。mod の manifest の検証は `component`・`required` を受け付ける。
- CLI: `ubichill dev` が毎回のビルドで参照の問題（未設定の必須参照・無い Entity・型の違う Entity）を検査し、ターミナルと dev パネルの診断（`DevFailure` の `kind: 'reference'`）に出す（止めはしない）。合成ワールドは合成の結果が変わったら部屋を作り直す（参照を足しただけでも配線し直す）。`world.yaml` が無いときに合成するワールドでは、型を宣言した参照をその型を置いた Entity に配線しておく。
