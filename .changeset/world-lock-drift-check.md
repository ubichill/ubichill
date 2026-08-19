---
"@ubichill/loader": minor
---

`ubichill install <world.yaml> --check` を追加した。`worlds/*.lock.json`（mod 完全性ロック）を
書き換えず、現在の mod ビルドと一致しているかだけを検証し、不一致なら非ゼロ終了する。

mod のソースを再ビルドしてハッシュが変わっても `worlds/*.lock.json` は自動更新されず、これまでは
`ubichill install` の実行を忘れると気づけないまま陳腐化していた（ローカル開発では console.warn の
み・ビルド後に古いハッシュのファイルが消えると SPA fallback の HTML を worker として読み込もうと
して失敗する、という分かりにくい壊れ方をする）。

`pnpm verify:world-locks`（内部で全 `worlds/*.yaml` に対して上記 `--check` を実行する
`scripts/check-world-locks.mjs`）を追加し、CI の `pnpm build:workers` 直後に `pnpm
verify:mod-locks` と並べて実行するようにした。あわせて、開発時の console.warn 2箇所に
`ubichill install <world.yaml>` を促す具体的なヒントを追加した。
