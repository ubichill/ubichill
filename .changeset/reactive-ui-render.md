---
"ubichill": minor
---

`Ubi.ui.render(factory, targetId)` が `factory()` 実行中に読んだ `Ubi.state` のキーを自動追跡し、そのキーが変わったときだけ自動で再描画するようになりました。`state.onChange(key, render)` による手動の再描画結線は不要になります（既存の呼び出しを残しても害はありません）。読まなかったキーの変化では再描画されないため、postMessage の送信数は増えません。

さらに、Worker ファイルが `export default function() { return <jsx/> }` のように UI をデフォルトエクスポートすると、初回の `Ubi.ui.render()` 呼び出しも不要になり自動でマウントされます。`Ubi.grip` の `isMine`/`holder` 等は内部で `Ubi.state` を読むため、これらも自動追跡の対象です。
