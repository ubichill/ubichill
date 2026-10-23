# プロトコルと互換の規則

Ubichill の約束ごと（プロトコル・データの形式・API）を、**だれが・どこに・どれだけ長く持つか**で 4 種類に分け、種類ごとに互換の扱いを決める。
互換を残すかどうかを場当たりで決めない。新しい約束ごとを作るときは、まずどの種類かを決めてここに足す。

| 種類 | 例 | 持つ人・場所 | 互換の扱い |
| --- | --- | --- | --- |
| A. 外に出るデータ | 署名・mod の lock・ワールドの YAML・サービストークン | 作者のリポジトリ・GitHub Pages・他のサーバー・外部サービス（こちらは消せない） | 形式に版を付ける。**作る側だけ新しくし、読む側は出したことのある版を読み続ける**。読む処理は 1 か所 |
| B. 公開している SDK とプロトコル | `ubichill`（npm）・Host ⇔ Worker の `PROTOCOL_VERSION` | 作者がビルドした mod の中 | semver。足すときは版を上げ、消すときは互換の最小の版も上げる（CI が確かめる） |
| C. サーバーの間の API | WebFinger・作者の鍵の一覧・ワールドの配信・連合の一覧（`scope=local`） | 版の違う他のサーバー | 足すだけ。意味を変えるときは新しい道（パス・パラメーター）を足す |
| D. 内部の API | フロント ⇔ backend（`/api/v1/users/me/...` など）・フロント ⇔ Go のインスタンス（`protocol/instance`） | 同じリポジトリ・同じ版でデプロイ | **互換を残さない**。フロントは backend との版のずれを検知して読み込み直す（`VersionSkewGuard`） |

非推奨（deprecated）の API は作らない。D は版のずれの検知で不要にし、A・B・C は最初から「足すだけ」で設計する。

## A. 外に出るデータ

| 形式 | 版 | 定義 | 置き場所 |
| --- | --- | --- | --- |
| ワールドの定義 | `apiVersion: ubichill.com/v1alpha1` | `shared/schemas/world.schema.ts` | `<world>.yaml` |
| mod の lock | `lockVersion: 1` | `shared/schemas/modLock.schema.ts` | `<world>.lock.json`・`v<版>/lock.json` |
| 作者署名（ワールド） | `version: 2`・`kind: 'world'` | `shared/signature/envelope.ts`（内容のハッシュは `shared/world/identity.ts`） | `<world>.sig.json` |
| 作者署名（mod） | `version: 2`・`kind: 'mod'` | `shared/signature/envelope.ts`（内容のハッシュは `shared/mod/modSignature.ts`） | `v<版>/lock.sig.json` |
| サービストークン | JWT（EdDSA） | `shared/mod/serviceToken.ts` | 外部サービスへ渡す |
| CLI・CI の認証情報 | `version: 1` | `sdk/cli/credentials.ts` | `~/.config/ubichill`・CI の Secret |

### 作者署名の形式（版 2）

ワールド・mod など、作者が署名するものはすべてこの 1 つの形式（封筒）で署名する。種類を足すとき（購入の証明など）も `kind` を足すだけにする。
版 1（ワールドと mod で別々だった形式）は、ワールドを作っていたのが私たちだけだったので読み続けずに署名し直した（2026-10）。

```json
{
  "format": "ubichill-signature",
  "version": 2,
  "kind": "world",
  "alg": "ed25519",
  "publicKey": "<base64url>",
  "author": "alice@example.com",
  "subject": "my-world",
  "subjectVersion": "1.0.0",
  "contentHash": "sha256-...",
  "signature": "<base64url>"
}
```

- **対象**: `kind` だけが違う（`world` / `mod`、今後 `license` など）。`contentHash` の求め方は種類ごとに決める（ワールドは `{ definition, lock }`、mod は lock の実行内容）。
- **署名する値**: `signature` 以外の全項目の正規化した JSON（RFC 8785 相当）。`format` と `kind` が入るので、別の種類・別の用途の署名として使い回せない。
- **作者**: 必須。正規の表記（`handle@domain`、ドメインは小文字）だけ。作者の無い署名は作らない。
- **検証の順番（どの種類も同じ）**: 形式を読む → 対象と内容のハッシュを照らす → 元のバイト列で署名を照合する → 作者の鍵を確かめる（`authorKeyDirectory`）。
- **CI**: 形式の固定のために、決まった鍵で作った署名の例（`shared/signature/vectors.v2.json`）を置き、`loader/src/signatureVectors.test.ts` が本物の Ed25519 で、いつまでも検証できることと、同じ鍵から同じバイト列ができることを確かめる。署名する値の作り方を変えると落ちる。形式を変えるときは版を上げ、新しい版の例を足す（古い版の例は残す）。

## B. 公開している SDK と Host ⇔ Worker のプロトコル

- コマンド・イベントの一覧は `shared/mod/protocol.contract.ts` に版ごとに残す。`protocol.contract.test.ts` が今の定義と照らし合わせる。
- 足す: `PROTOCOL_VERSION` を +1 し、契約に新しい版を足す。消す・意味を変える: さらに `MIN_COMPATIBLE_PROTOCOL_VERSION` を上げる。どちらも忘れると CI が落ちる。
- **CI が見るのはコマンド・イベントの名前の増減だけ**。ペイロードの型や意味を変えたこと（項目を必須にした・単位を変えたなど）は検知しない。
  `shared/mod/protocol.ts` と `shared/mod/types.ts` のペイロードの型を変える PR は、互換を壊していないかをレビューで確かめる。
- SDK のビルド結果が変わったのに changeset が無ければ落ちる（`packages/sdk/check-drift.mjs`）。

## C. サーバーの間の API

| API | 使う側 |
| --- | --- |
| `GET /.well-known/webfinger` | 作者を確かめる他のサーバー・ブラウザ |
| `GET /api/v1/authors/:handle/signing-keys` | 同上（`Access-Control-Allow-Origin: *`） |
| `GET /api/v1/authors/:handle/worlds/:name.yaml`（`.lock.json`・`.sig.json`） | ワールドを読む他のサーバー |
| `GET /api/v1/worlds?scope=local` | 連合のピア（このサーバーのワールドだけを返す） |
| `GET /api/v1/service-tokens/keys` | サービストークンを検証する外部サービス |

## D. 内部の API

フロントと backend は同じ版でデプロイする。開いたままの古いタブは、`VersionSkewGuard` が backend の版（`/api/version`）と比べ、ずれていればインスタンスの外ではすぐ、中では知らせてから読み込み直す。
そのため内部の API は、互換を残さずに変えてよい（Host の内部の実装は後方互換性に囚われない、という CLAUDE.md の方針の前提）。

インスタンスのプロトコル（`protocol/instance`）も D で、イベントを足す・消すときに互換の層を作らない。
`protocolVersion` を上げると古いタブは入室そのものを確定した失敗にするので、上げるのは接続・入室の手順やフレームの形を変えたときだけにする（イベントの増減では上げない）。
例: `server:notice`（その場だけの知らせ）はイベントを足しただけなので上げない。古いタブは知らないイベントを読み飛ばし、新しいタブも知らない `kind` を読み飛ばす。

通知の API（`/api/v1/notifications`・SSE）も D。ただし通知の形（`shared/notification/activity.ts`）は ActivityStreams 2.0 に寄せてあり、
ほかのサーバーと送り合うようになったら、その送り合う形は C（足すだけ）として扱う。

## 設計の規則を CI で守る

`scripts/architecture.mjs`（`pnpm check:architecture`）が、次の規則を全ソースに当てる。規則ごとに理由を持つ。

| 規則 | 守るもの |
| --- | --- |
| `host-runs-mods-without-backend` | Host は SNS backend の無い単体モードでも mod を動かす（mod の経路から Host の API を呼ばない） |
| `shared-is-pure` | shared は Node・DOM・ネットワークに依存しない（ブラウザ・backend・CLI が同じ規則を使う） |
| `loader-main-is-browser-safe` | loader の既定の入口はブラウザで読める |
| `backend-runs-built-packages-only` | backend はソースのまま配るパッケージに依存しない |
| `mods-use-public-sdk-only` | mod は公開パッケージ `ubichill` だけに依存する |
| `signatures-in-one-place` | Ed25519 の照合は shared の署名・鍵の証明の部品（`signature/envelope.ts`・`world/identity.ts`・`user/cliAuth.ts`）の中だけ |

規則を足すときは、何を守るのかを `why` に書く。
