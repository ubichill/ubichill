---
"@ubichill/shared": minor
"@ubichill/cli": minor
"@ubichill/backend": minor
---

mod と ubichill の版を固定する。エディタは `latest` を書かず、既存の `latest` は保存時に lock の版へ固定する。`ubichill install world.yaml` は版を書いていない依存の最新版を取って world.yaml に固定し（以後の install では変えない。上げるのは `update`）、`update` も `latest` を版に書き換える。書き換えるのは版の行と `spec.requires` だけで、ほかの整形とコメントは変えない。ワールドは ubichill の版（`spec.requires.protocol`）を固定し、エディタの mod 管理の一覧で mod と同じく上げられる。古い版に固定したワールドはそのまま動かし、Host より新しい版のワールドだけ入る前とエディタで知らせる。Host のイメージは公開済みの mod の版を戻してからビルドし、一度公開した版を配り続ける。
