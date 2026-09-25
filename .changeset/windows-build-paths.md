---
"@ubichill/sdk": patch
---

`ubichill build` が Windows でワーカー/アセットの相対パスを誤って算出し、絶対パスが出力先・コンポーネント名に混入してビルドが失敗する問題を修正
