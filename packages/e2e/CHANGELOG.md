# @ubichill/e2e

## 0.1.0

### Minor Changes

- a573457: プレビュー・ローカルの `pnpm dev` に対するスモークテストを足す（`pnpm smoke <URL>`）。API と WebSocket の通し（2 人の入室・カーソル・共有状態）と、Playwright のブラウザでの登録・ログイン・入室・pen の Worker の読み込みを確かめる。CI の preview-status が結果をプレビューのコメントに載せる（今は情報だけで、マージは止めない）。
