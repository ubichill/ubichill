---
"@ubichill/loader": minor
---

`ubichill install <world.yaml> --check` を追加した。`worlds/*.lock.json`（mod 完全性ロック）を
書き換えず、現在の mod ビルドと一致しているかだけを検証し、不一致なら非ゼロ終了する。

mod のソースを再ビルドしてハッシュが変わっても `worlds/*.lock.json` は自動更新されず、これまでは
`ubichill install` の実行を忘れると気づけないまま陳腐化していた（ローカル開発では console.warn の
み・ビルド後に古いハッシュのファイルが消えると SPA fallback の HTML を worker として読み込もうと
して失敗する、という分かりにくい壊れ方をする）。

`worlds/*.lock.json` は `pnpm-lock.yaml` と同じ「コミットされる、レビュー可能な固定ピン」という
位置づけ（外部/URL 由来のワールドを読み込む側は今も不一致を fail-closed 拒否する。参照:
`packages/loader/src/acquireMod.ts` の `requiresLock`）。そこで `pnpm build:workers` の最終
ステップとして `worlds/*.yaml` 全件の lock を自動再生成するようにし（`pnpm gen:world-locks` /
`scripts/world-locks.mjs`）、「mod を直したのに手動コマンドを忘れて陳腐化する」というミスの
クラスを無くした。CI では `pnpm build:workers`（regen 込み）の直後に `git diff --exit-code --
worlds/` を実行し、再生成後の内容とコミット済みの内容がズレていれば（＝再生成した lock を
コミットし忘れていれば）落とす（frozen-lockfile チェックと同じパターン）。
`pnpm verify:world-locks`（`scripts/world-locks.mjs --check`）はローカルで手早く陳腐化だけ
確認したいときのユーティリティとして残す。あわせて、開発時の console.warn 2箇所に
`ubichill install <world.yaml>` を促す具体的なヒントを追加した。
