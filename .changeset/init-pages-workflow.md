---
"@ubichill/cli": minor
---

`ubichill init mod|world` の雛形に、GitHub Pages へ公開するワークフロー（`.github/workflows/pages.yml`）と README を足す。mod はビルド（公開済みの版の履歴を引き継ぐ）→ 署名 → 署名の検査 → 前の版を残して `gh-pages` に足す → 配置を確かめてカタログに登録、ワールドは署名して書き出し → 検査 → 配置。Action は commit の SHA で固定し、署名の鍵は Secret `UBICHILL_CREDENTIALS`、公開先は既定で `https://<owner>.github.io/<repo>`（リポジトリの変数 `UBICHILL_PUBLIC_URL` で変えられる）。mod の雛形の Component は `ui:render` を宣言し、最初のビルドで capability の注意が出ないようにする。
