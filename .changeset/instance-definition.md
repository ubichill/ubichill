---
"@ubichill/shared": minor
"@ubichill/cli": minor
---

ワールド定義の検証・写像（`definitionToResolved`）と、Go のインスタンスサーバーに渡す定義を作る `toInstanceDefinition` を `@ubichill/shared` に置き、backend と CLI が同じ変換を使う。`ubichill world build <world.yaml>` で、手元のワールドから `ubichill-instance --world` 用の定義 JSON を作れる。
