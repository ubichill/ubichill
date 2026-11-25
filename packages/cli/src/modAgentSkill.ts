/**
 * `ubichill init mod` の雛形に入れる、AI エージェント向けの skill（Agent Skills の SKILL.md）。
 * Codex は `.agents/skills`、Claude Code は `.claude/skills` を読むので、同じ中身を両方に置く
 * （シンボリックリンクは Windows の clone で壊れるので使わない）。
 * API の一覧は書き写さず、インストールした `ubichill` の README と型を正とする（CLI と SDK の版がずれても嘘にならないように）。
 * ここに書くのは、型からは分からない実行環境の制約と、公開の決まりだけ。
 */

export const MOD_AGENT_SKILL_NAME = 'ubichill-mod';
export const MOD_AGENT_SKILL_PATHS = [
    `.agents/skills/${MOD_AGENT_SKILL_NAME}/SKILL.md`,
    `.claude/skills/${MOD_AGENT_SKILL_NAME}/SKILL.md`,
] as const;

const DOCS = 'https://github.com/ubichill/ubichill/blob/main/docs';

export const MOD_AGENT_SKILL = `---
name: ${MOD_AGENT_SKILL_NAME}
description: この ubichill の mod（src/**/*.worker.tsx）を書く・直す・ビルドする・公開するときに使う。Worker の中でできること・できないこと、状態と権限の扱い、公開の決まり。
---

# ubichill の mod

## 正とするもの

- API は \`node_modules/ubichill/README.md\` と \`node_modules/ubichill/index.d.ts\`（\`Ubi\` の型の説明）。インストールした版の内容なので、この skill と食い違ったらそちらに従う。
- 仕組みの説明: [配布と署名](${DOCS}/MOD.md)・[実行環境](${DOCS}/MOD_RUNTIME.md)・[権限](${DOCS}/CAPABILITIES.md)

## Worker の中

- \`src/**/*.worker.tsx\` の 1 ファイルが 1 つの Component で、1 つの Worker で動く。\`export const config\`（\`ComponentConfig\`）がメタデータ、\`export default\` の関数が UI で、自動で描画される。
- \`Ubi\` はグローバル。値として import しない（\`src/env.d.ts\` が型を宣言している）。型は \`import type { … } from 'ubichill'\`。
- DOM（\`window\`・\`document\`）は無い。\`fetch\`・\`XMLHttpRequest\`・\`WebSocket\`・\`indexedDB\`・\`navigator\`・\`importScripts\` も取り除かれている。通信は \`Ubi.fetch\`、共有と保存は \`Ubi.state\`、同梱したファイルは \`Ubi.asset\` を使う。
- \`eval\`・\`new Function\`・文字列を渡すタイマーは実行時に \`EvalError\` になる。npm のライブラリがこれらを使っていると動かない。
- ブラウザの CORS は解除されない。CORS を許していない API は \`Ubi.fetch\` でも読めない。

## 状態

- ほかの人と共有したい値・保存したい値は \`Ubi.state.define({ key: Ubi.state.sync(初期値) })\` に置く。モジュールの変数に置いた値はほかの人に届かず、入り直すと消える。
- \`sync\` の既定は「全員で共有して保存」。人ごとに持つなら \`{ perUser: true }\`、保存しない一時的な値なら \`{ ephemeral: true }\`。\`sync\` を付けない値（\`count: 0\`）は自分の Worker の中だけ。
- UI の関数の中で読んだ状態は自動で追跡され、変わったときだけ描き直される。手で描き直さない。

## 権限

- 権限（capability）は、使った \`Ubi\` の API からビルドのときに自動で決まる。\`config.capabilities\` に書き足すのは、自動で拾えないときだけ。
- \`net:fetch\` は dangerous で、利用者に接続先のドメインごとの承認を求める。要らないなら使わない。

## 確かめる

- \`npm run dev\`: 手元に Host とインスタンスサーバーを起こす（DB・Docker は要らない）。タブを 2 つ開くと同期を試せる。
- \`npm run build\`: 型チェックのあとビルドする。

## 公開

- 作者の署名が必須。\`ubichill login\` のあと \`ubichill publish dist --public-url=<配置先>\`。CI での公開は \`.github/workflows/pages.yml\` が行う（有効にする手順は README）。
- 公開した版の中身は変えない。直したら \`package.json\` の \`version\` を上げる。同じ版に違う中身を出そうとすると publish が失敗する。
- 配置先から以前の版を消さない。その版を固定したワールドが読めなくなる。
`;
