---
"@ubichill/cli": patch
---

`ubichill dev` を videoplayer・chillwa で使ってみて分かった点を直す。

- world.yaml が無いときに合成するワールドを、実際のワールドと同じ形（mod ごとの親の下に Component を 1 つずつ）にし、`defaultTransform` の位置に置く。`scope: 'siblings'` のイベントが届くようになる。
- ワールドだけのリポジトリ（`src/` が無い）でも `ubichill dev worlds/x.yaml` で動く。mod はすべて `source.url` から取る。
- Ctrl+C（`npm run dev` / `npx` が SIGINT を転送して 2 回届く）や、ポートが使用中で起動できないときに Go が残らない。
- 署名の無い手元の mod の署名ファイルを 204 で返す（ブラウザのコンソールに 404 を出さない）。
- dev の状態表示を右上の小さな札にする（上端の帯が `overlay: top-left` の HUD を隠していた）。
- 取れない mod の診断に、手元に無いのか `source.url` から取れないのかを出す。
