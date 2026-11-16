---
"@ubichill/cli": minor
---

mod に説明を書けるようにする。`package.json` の `ubichill.description`（500 文字まで。文字列でない・長すぎる説明は `ubichill build` で止める）を manifest の `description` に入れ、エディタの mod 管理の一覧と作品ページに出す。npm の `description` は読まない（名前が無いときに名前として使ってきたため、既存の mod の manifest は変わらない）。
