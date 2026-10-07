# mod の実行環境 — WASM・バイナリ・同梱アセット

mod が各ユーザーのブラウザ内で WASM や外部ライブラリを動かし、バイナリを取得・処理するための仕組み。
Ubichill が提供するのは**用途を限定しない実行・通信・データ処理の基盤**だけで、特定の mod（動画再生など）
のための機能は持たない（→ [#202](https://github.com/ubichill/ubichill/issues/202)）。

関連: [ARCHITECTURE.md](./ARCHITECTURE.md)（Sandbox）/ [CAPABILITIES.md](./CAPABILITIES.md)（権限）/
[MOD.md](./MOD.md)（配布・lock）/ [API.md](./API.md)（`Ubi.*`）

---

## 実行モデル

1 Component = 1 Worker。Worker の中は 2 層に分かれる。

| 層 | 動くもの | 持つ権限 |
| --- | --- | --- |
| JS 層 | lock で固定した mod のコード（`index.<hash>.js`）だけ | `Ubi` 経由の API のみ。通信・保存・スクリプト読み込みの入口は Worker 起動時に封鎖する |
| WASM 層 | mod が持ち込んだ WASM（Rust / C / Go / Python ランタイムなど） | `WebAssembly.instantiate(module, imports)` の `imports` に渡したものだけ |

- **JS の動的なコード生成は禁止**（`eval`・`Function`・関数の `constructor`・文字列のタイマー）。実行時に
  `EvalError` になる。外部から取ってきたコードを動かしたい場合は、QuickJS などのインタプリタを WASM として
  同梱し、その中で動かす（WASM 層は imports 以外に何も触れない）。
- **WASM は任意のバイト列からコンパイルできる**。WASM は imports で渡した関数しか呼べないため、JS 層の
  権限を越えない。

### 封鎖の 2 段構え

| 段 | 何をするか | どこで効くか |
| --- | --- | --- |
| Worker 内の封鎖（`packages/sandbox/src/worker/lockdown.ts`） | `fetch`・`XMLHttpRequest`・`WebSocket`・`WebTransport`・`EventSource`・`importScripts`・`Worker`・`BroadcastChannel`・`indexedDB`・`caches`・`navigator`・`FontFace` などを **`self` とプロトタイプチェーンの全段から**取り除く。コード生成の入口も止める。1 つでも取り除けなければ mod を実行しない | どの配信方法でも効く |
| Worker 専用の CSP（`SANDBOX_WORKER_CSP`） | 本番は `default-src 'none'; script-src 'unsafe-eval' 'wasm-unsafe-eval'`。スクリプトの URL を 1 つも許可しないので、封鎖を抜けても通信できず、`import()` で**同一オリジンの JS（他の mod のアセット等）も読めない**。dev は Vite が Worker の依存（`packages/{sandbox,sdk,shared,ecs,runtime,core-components}/src/` と `node_modules/.vite/deps/`）をモジュールごとに配信するため、そのパスだけを許可する | BFF（本番）と Vite（dev / preview）が Worker スクリプトに付ける。それ以外の配信方法では付かない |

> 以前は `self` の上書きと文字列検査だけだったため、`Object.getPrototypeOf(self).fetch.call(self, '/api/v1/…')`
> で本体の API に cookie 付きで届いた。文字列検査は WASM のグルーコード（Emscripten・wasm-bindgen が含む
> `importScripts` や `Function(` という文字列）を誤検知する一方で、上の抜け道は防げなかったので廃止した。
> 実ブラウザで抜け道が塞がっていることは `packages/sandbox/src/worker/sandbox.browser.test.ts` が毎回確かめる。

---

## API

### `Ubi.asset` — 同梱アセット（権限 `asset:read`・safe）

```ts
const bytes = await Ubi.asset.bytes('data/table.bin');   // ArrayBuffer（integrity 照合済み）
const text = await Ubi.asset.text('readme.txt');          // UTF-8
const module = await Ubi.asset.wasm('engine.wasm');       // WebAssembly.Module（同じパスは 1 回だけコンパイル）
const { exports } = await WebAssembly.instantiate(module, { env: { /* WASM に許すものだけ */ } });
```

- パスは mod の `assets/` からの相対。`..`・絶対パス・`%`・クエリは拒否する（`ASSET_INVALID_PATH`）。
- manifest に無いファイルは読めない（`ASSET_NOT_DECLARED`）。中身が manifest と違えば渡さない（`ASSET_INTEGRITY_MISMATCH`）。
- `{ signal }` で取り消せる。

### `Ubi.fetch` — バイナリ・上限・取り消し（権限 `net:fetch`・dangerous）

```ts
const controller = new AbortController();
const res = await Ubi.fetch('https://cdn.example.com/model.bin', {
    responseType: 'arrayBuffer', // 既定は 'text'（従来どおり）
    maxBytes: 64 * 1024 * 1024,  // 本文の上限。超えたら読み込みを止める
    timeoutMs: 60_000,           // ドメイン承認の待ち時間を含む制限時間
    signal: controller.signal,   // abort で取り消し → FETCH_ABORTED の UbiError
});
if (!res.ok) console.warn(res.error?.code ?? `HTTP ${res.status}`);
else process(new Uint8Array(res.body)); // res.body は ArrayBuffer（コピーせずに Worker へ移る）
```

- 送信本文に `ArrayBuffer` / `Uint8Array` を渡せる（Host へはコピーして送る）。
- Host が合成した失敗（ドメイン拒否・制限時間・サイズ超過・通信失敗）は reject ではなく `ok: false` と
  `error.code` で返る（`FETCH_DOMAIN_NOT_ALLOWED` / `FETCH_TIMEOUT` / `FETCH_RESPONSE_TOO_LARGE` /
  `FETCH_NETWORK_ERROR` / `FETCH_REDIRECT_BLOCKED`）。サーバーの 404 などには `error` は付かない。
- 取り消し（`signal`）だけは reject（`FETCH_ABORTED`）。標準の `fetch` と同じ。

### `Ubi.runtime` — 実行環境の能力

```ts
if (!Ubi.runtime.supports('wasm:jspi')) fallbackToAsyncApi();
Ubi.runtime.require('wasm'); // 使えなければ UNSUPPORTED_FEATURE の UbiError
```

| feature | 意味 | 決まり方 |
| --- | --- | --- |
| `wasm` | WebAssembly | ブラウザ |
| `wasm:simd` | 128bit SIMD | ブラウザ |
| `wasm:exceptions` | WASM の例外処理（新しい Pyodide などが使う） | ブラウザ |
| `wasm:threads` | 共有メモリのスレッド | **現在は常に false**（ページが cross-origin isolated ではないため） |
| `wasm:jspi` | JS Promise Integration（同期的に書かれた WASM から非同期 API を待つ） | ブラウザ |
| `fetch:binary` / `asset` | 上記の API | Host のプロトコル版（v4 以上） |

古い Host には `Ubi.runtime` 自体が無い。古い Host でも動かしたい mod は `Ubi.runtime?.supports(...)` と書く。

### 制限値（`FETCH_LIMITS`）

| 項目 | 既定 | 上限 |
| --- | --- | --- |
| `timeoutMs`（承認待ちを含む） | 120 秒 | 300 秒 |
| `maxBytes`（fetch の本文） | 32 MiB | 256 MiB |
| アセット 1 ファイル | — | 256 MiB（制限時間は 120 秒） |

---

## 配布と完全性

```
mods/<id>/assets/**  ──ubichill build──▶  v<ver>/<path>            （そのままコピー）
                                          manifest.json.assetIntegrity[path] = sha256-…
                                          lock.json.manifestIntegrity        = manifest の sha256
world の lock（manifestIntegrity）──▶ loader が manifest を照合 ──▶ Host がアセットを照合
```

- manifest は lock で固定されているので、manifest に載ったアセットの hash も固定される。lock の形式は変えていない。
- アセットの無い mod の manifest は従来とバイト単位で同じ（既存の lock を壊さない）。
- `manifest.json`・`lock.json`・`mod.json`・`index.json` と、Component 名と同じディレクトリは `assets/` に置けない（ビルドが失敗する）。
- `ubichill verify` はアセットも再ハッシュして manifest と突き合わせる。
- 古い CLI でビルドした mod（`assetIntegrity` が無い）は `Ubi.asset` で読めない。`Ubi.modBase` 配下を
  `Ubi.fetch` で読むことはできるが、その場合は integrity の照合が無い。

---

## 通信の境界

Host が許可しても、**ブラウザの制限は解除されない**。

| 規則 | 内容 |
| --- | --- |
| 自分のアセット（`modBase` 配下）・自分の名前空間（`/mods/<id>/`） | 承認不要 |
| 本体オリジンのそれ以外（`/api` など） | 禁止 |
| 外部ドメイン | https のみ。ホスト名ごとにユーザーが承認（「今回だけ / 次回以降も / 拒否」） |
| リダイレクト | **追わない**（`FETCH_REDIRECT_BLOCKED`）。ブラウザは行き先を送信前に見せないため、追うと未承認の相手へ送信本文や cookie が届き得る。最終的な URL を直接指定する |
| cookie | 外部オリジンには送らない（`credentials: 'omit'`）。同梱アセットの取得も cookie を付けない |
| 承認待ちの取り消し | `signal` の取り消し・制限時間で、承認画面を待つ依頼から外れる。同じドメインを待つ依頼がすべて外れたら画面を取り下げる（拒否としては記憶しない） |
| CORS | 相手が `Access-Control-Allow-Origin` を返さなければ失敗する（`FETCH_NETWORK_ERROR`） |
| 応答ヘッダー | CORS で公開されたもの（`Access-Control-Expose-Headers`）しか読めない |
| 禁止ヘッダー | `Cookie`・`Origin`・`User-Agent` などはブラウザが送らせない |

承認はホスト名の完全一致で記憶する。サブドメインが毎回変わる配信元（CDN のエッジなど）では、ホストごとに確認が出る。

---

## 実行ライフサイクル

- **終了**: 退室・エンティティ削除・mod の差し替えで Worker を `terminate` する。WASM のメモリも一緒に消える。
  Host 側で実行中の fetch・アセット読み込みは同時に取り消す（応答を捨てるだけでなく通信も止める）。
- **初期化と再利用**: Worker の中では module スコープに置いたもの（`Ubi.asset.wasm` のキャッシュ、
  インスタンス化した WASM）がそのまま使い回せる。
- **重い処理の分離**: 重い計算は Component の Worker をその間止める（UI・入力の処理も止まる）。初期化が
  数秒かかるランタイム（Pyodide 等）や、複数の Component から共有したい処理は、**`singleton: true` の
  Component** に置く。singleton は参加中のクライアントごとに 1 つだけ起動し、mod がワールドで使われている
  間だけ生きる。他の Component からは `Ubi.event.emit(..., { scope: 'world', targetType })` で依頼する。
  専用の Worker 種別は作っていない（Component の仕組みで足りるため）。

---

## ブラウザだけでできる範囲 / それ以外が必要な範囲

| | ブラウザだけで可能 | 拡張機能・ネイティブなどが必要 |
| --- | --- | --- |
| WASM の実行 | ○（SIMD・例外処理・JSPI はブラウザ次第） | — |
| 共有メモリのスレッド | ×（Host が COOP/COEP を出していない） | Host 側の対応（他オリジンの埋め込みとの両立が要る） |
| CORS を許可している API・CDN からの取得 | ○ | — |
| CORS を許可していないサイトからの取得 | × | 拡張機能（host_permissions）・ネイティブ・中継サーバー |
| 任意の cookie・`User-Agent`・`Origin` の送信 | × | 同上 |
| 他オリジンのページの JS をその場で実行 | ×（JS のコード生成は禁止） | WASM 上のインタプリタ（QuickJS 等）なら可能 |
| 同期的な通信（同期 XHR） | ×（Worker 内の通信手段は非同期の `Ubi.fetch` だけ） | JSPI で非同期を待つ |

### 例: yt-dlp を各クライアントで動かす場合（videoplayer 側の責務）

2026-10-07 にブラウザ（Chrome、オリジン `http://localhost`）から実測した結果:

| 取得先 | 結果 |
| --- | --- |
| `www.youtube.com/watch` | CORS で失敗 |
| `www.youtube.com/youtubei/v1/player` | CORS で失敗 |
| `www.youtube.com/oembed` | 成功（タイトル・サムネイル） |
| `i.ytimg.com`（サムネイル） | 成功 |
| `cdn.jsdelivr.net/pyodide/…` | 成功 |

- この基盤で、Pyodide（WASM・標準ライブラリ）の読み込み、Python の実行、JS challenge を QuickJS 等の WASM で
  解くこと、結果の URL を `Ubi.media.load` に渡すことは mod 側で実装できる。
- しかし yt-dlp が最初に叩く YouTube のページと player API はブラウザから CORS で読めない。**ブラウザだけで
  YouTube の URL を解決することはできない**。拡張機能・ネイティブの補助か、中継サーバー（＝サーバーに URL が
  渡る）が必要になる。これは Ubichill 側で解除できる制限ではない。
- タイトル・サムネイルの取得（oEmbed・ytimg）は今でもサーバー無しにできる。

### 大きなランタイム（Pyodide など）を載せるときの注意

- JS のグルーコードは mod のバンドルに含める（`importScripts`・`import()` での読み込みは封鎖・CSP で失敗する）。
- WASM・標準ライブラリの zip・wheel は `Ubi.asset`（同梱）か `Ubi.fetch` の `responseType: 'arrayBuffer'`
  （CDN）で取得し、ランタイムの読み込み関数に渡す。ランタイムが内部で `fetch` を呼ぶ場合は、`Ubi.fetch` を
  使う関数をバンドル内で `fetch` として渡す（グローバルの `fetch` は無い）。
- 実行時に `eval` / `new Function` を呼ぶ箇所（Emscripten の動的リンクで読み込む拡張モジュールの EM_JS など）は
  `EvalError` で失敗する。使わない構成を選ぶ。
- 同期的な通信が必要な Python コード（`urllib` など）は、JSPI（`wasm:jspi`）で非同期の `Ubi.fetch` を待つ形にする。

---

## 今後の候補（未実装）

- 本文のストリーミング（今は `maxBytes` まで読んでから一度に渡す。`Range` ヘッダーで分割取得はできる）。
- 同じ mod の Worker 間で、コンパイル済みの `WebAssembly.Module` を共有する。
- 拡張機能・ネイティブの補助を、特定サービス専用ではない「通信手段」として Host に差し込む。
- 承認をサフィックス単位（`*.example.com`）で記憶する。
- アセット・lock の署名（今は hash の固定のみ）。
