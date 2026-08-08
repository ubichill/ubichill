---
"@ubichill/sdk": minor
---

`ubichill build` が `index.json`（レジストリ一覧: `id`/`name`/`version`/`components`）を自動生成するようになった。

- 単一mod（外部リポジトリ）: 自分自身を1件だけ含む配列を `distDir`/`publicDir` に出力する。World Editor の「レジストリ URL を追加」機能にそのまま渡せる。
- モノレポの一括ビルド: 全 mod を集約した配列をバッチルートに出力する。

`buildMod()` の戻り値が `void` から `{ id, name, version, components }`（`ModIndexEntry`）に変わった。
