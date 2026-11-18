---
'@ubichill/cli': patch
---

`ubichill build` と `ubichill verify` の検査を厳しくする。

- `build` は `package.json` の `version` を x.y.z に限る（Host が受け付けない `1.0.0-beta.1` や、出力先の外に書き出す `../` を含む版で止める）。`index.json` の版の履歴は SemVer の順に並べる。
- `export const config` をテンプレート文字列・定数・スプレッドなどで書いて静的に読めないときは、capabilities・dataFields などの宣言を取り込めないことを警告する（これまでは黙って落としていた）。文字列の `\x`・`\u`・数字・行の継続のエスケープは誤訳せず読めないものとして扱い、`\b`・`\f`・`\v` は JS と同じ文字に読む。
- `verify` は、`lock.json` の無い版のディレクトリと、版のディレクトリが 1 つも無い出力を不合格にする（`build` は常に `lock.json` を書く）。
