---
"@ubichill/sdk": minor
"@ubichill/shared": minor
"@ubichill/cli": minor
---

Component 同士を、階層の形ではなく**型付きの参照**で配線できるようにした（#191）。

- SDK: `dataFields` の `entityRef` / `entityRefArray` に `component`（参照先が持つべき Component 型）と `required` を足した。`Ubi.event.emit(type, data, { ref: '<フィールド名>' })` で、ワールド作者が指した Entity のその型の Component にだけ届く。`scope: 'referrers'` で、参照で自分を指している Component に返せる。`EmitOptions` は `{ scope }` か `{ ref }` のどちらか一方（両方・どちらも無しは型で弾く）。既存の `scope` の意味は変えていない。
- shared: 参照の解決と検査（`resolveRefs`・`findReferenceProblems`・`describeReferenceProblem`）。World Editor・`ubichill dev`・Host の配送が同じ判定を使う。mod の manifest の検証は `component`・`required` を受け付ける。
- CLI: `ubichill dev` がワールドを作るとき、参照の問題（未設定の必須参照・無い Entity・型の違う Entity）をターミナルに出す（止めはしない）。`world.yaml` が無いときに合成するワールドでは、型を宣言した参照をその型を置いた Entity に配線しておく。
