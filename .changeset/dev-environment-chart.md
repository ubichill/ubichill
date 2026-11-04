---
"@ubichill/backend": patch
"@ubichill/react": patch
---

dev 環境と負荷試験のための chart・CI・クライアントの変更。

- CI: main への push で `:main-<sha>` タグも付ける（dev 環境の Image Updater が追う。`:sha-<sha>` は PR のプレビューにも付くので区別する）。
- chart: `instanceRuntime.nodeSelector` / `affinity` / `tolerations` で Go の Pod の配置を指定できる（負荷の生成器と別のノードに置く）。
- chart: Go の権限を絞る。Role は pods の `patch` だけにし、`ValidatingAdmissionPolicy`（`instanceRuntime.autoscaling.deletionCostPolicy.enabled`、既定 true）で、この ServiceAccount からの更新を「同じ release の instance の Pod の pod-deletion-cost の注釈だけ」に限る。
- react: 部屋の引っ越し中に `code: "migrating"` で断られた要求（entity:patch など）を 500ms おきに最大 20 回送り直す。利用者からは失敗に見えない。
