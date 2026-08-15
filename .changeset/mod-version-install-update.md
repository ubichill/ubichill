---
"@ubichill/sdk": minor
---

`ubichill lock` を `ubichill install` に改名し、world.yaml の `dependencies[].source.version`（完全一致 `x.y.z` のみ）を実際に解決するようにした。従来はこのフィールドが lock 生成時に一切参照されず、常に最新版が固定されていた。

- `ubichill install <world.yaml>`: `source.version` が pin されていればそのバージョンを直接取得してlockする。`ubichill lock` は非推奨エイリアスとして残る（既存スクリプトを壊さないため）。
- `ubichill update <world.yaml> [<modName>]`: pin済みバージョンが古ければ最新へ world.yaml を書き換え（コメント/フォーマットは保持）、lock を再生成する。
- `ubichill build` が出力する `index.json` に、過去にビルドした全バージョンの履歴（`versions`）を追加した（トップレベルの `id`/`name`/`version`/`components` は従来通り現行最新のまま）。

`DependencySourceSchema.version` は `SemVer`（`x.y.z`）または明示的な `'latest'` のどちらかで検証されるようになった（`^`/`~` などのレンジ指定は非対応）。省略時も解決後は必ず `'latest'` になる（zod default）ため、「省略＝常に最新を追う」という暗黙の意味を読み手が推測する必要がない。
