/**
 * `ubichill init` の雛形のうち、GitHub Pages への公開（ワークフローと README）。
 * 公開の手順は README の「CI から公開する」と同じ: ビルド → 署名 → 前の版を残して gh-pages に足す → 配置を確かめてカタログに登録。
 * ワークフローの式とシェルの変数展開は、テンプレート文字列の中で `\${` と逃がして書く。
 */

/** 作者のリポジトリで動くので、Action は commit の SHA で固定する（タグは付け替えられる）。 */
export const PAGES_ACTIONS = {
    checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
    setupNode: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0',
    ghPages: 'peaceiris/actions-gh-pages@84c30a85c19949d7eee79c4ff27748b70285e453 # v4.1.0',
} as const;

const credentials = `        env:
          UBICHILL_CREDENTIALS: \${{ secrets.UBICHILL_CREDENTIALS }}
`;

// 署名の鍵（Secret）は使うステップにだけ渡す。npm の依存の install スクリプトは動かさず、checkout は git に認証を残さない
const header = `name: GitHub Pages に公開する

on:
  push:
    branches: [main]
  workflow_dispatch:

# 配置と登録を 1 回ずつ進める（途中で取り消すと、置いた版と登録がずれる）
concurrency:
  group: pages
  cancel-in-progress: false

permissions: {}

jobs:
  publish:
    runs-on: ubuntu-latest
    # gh-pages に書く
    permissions:
      contents: write
    steps:
      - uses: ${PAGES_ACTIONS.checkout}
        with:
          persist-credentials: false
      - uses: ${PAGES_ACTIONS.setupNode}
        with:
          node-version: 24
          cache: npm
      - run: npm ci --ignore-scripts
      - name: 署名の鍵と公開先を確かめる
        env:
          UBICHILL_CREDENTIALS: \${{ secrets.UBICHILL_CREDENTIALS }}
          # 独自ドメインなどで公開先が https://<owner>.github.io/<repo> でないときだけ、リポジトリの変数に入れる
          UBICHILL_PUBLIC_URL: \${{ vars.UBICHILL_PUBLIC_URL }}
        run: |
          if [ -z "$UBICHILL_CREDENTIALS" ]; then
            echo "::error::Secret UBICHILL_CREDENTIALS がありません。README の「GitHub Pages に公開する」を見て設定してください"
            exit 1
          fi
          npx ubichill whoami
          owner=$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')
          url="\${UBICHILL_PUBLIC_URL:-https://$owner.github.io/\${GITHUB_REPOSITORY#*/}}"
          echo "PUBLIC_URL=\${url%/}" >> "$GITHUB_ENV"
`;

const deploy = `      # 前に置いたファイルを消さずに足す（以前の版を固定したワールドが読めなくならないように）
      - uses: ${PAGES_ACTIONS.ghPages}
        with:
          github_token: \${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
          keep_files: true
`;

const modSteps = `      # 公開済みの版の履歴（index.json）を引き継ぐ
      - run: npm run build -- --registry-url="$PUBLIC_URL"
      # 署名する。公開先に同じ版の別の中身があればここで止まる（package.json の version を上げる）
      - name: 署名する
${credentials}        run: npx ubichill publish dist --public-url="$PUBLIC_URL"
      - run: npx ubichill verify --dist-dir=dist --require-signatures
${deploy}      # Pages に出た中身と署名を確かめてから、作者のサーバーのカタログに登録する。
      # 終了コード 1 は公開先をまだ確かめられない（反映を待ってやり直す）、2 は登録できなかった（やり直さずに止める）
      - name: カタログに登録する
${credentials}        run: |
          for attempt in $(seq 1 10); do
            status=0
            npx ubichill publish dist --public-url="$PUBLIC_URL" --check-public --require-registration || status=$?
            if [ "$status" -eq 0 ]; then exit 0; fi
            if [ "$status" -ne 1 ]; then
              echo "::error::カタログに登録できませんでした。上のログの理由を見てください"
              exit 1
            fi
            echo "Pages への反映を待っています（$attempt/10）"
            sleep 30
          done
          echo "::error::$PUBLIC_URL で mod を確かめられませんでした。Settings → Pages で gh-pages ブランチを選んでいるか確かめてください"
          exit 1
`;

const worldSteps = `      # mod を固定し、署名した world.yaml・.lock.json・.sig.json を dist に書き出して、作者のユーザーページに登録する（登録できなければ止める）
      - name: 署名して登録する
${credentials}        run: npx ubichill publish world.yaml --out=dist --public-url="$PUBLIC_URL" --require-registration
      - run: npx ubichill verify dist/world.yaml
${deploy}`;

export function pagesWorkflow(kind: 'mod' | 'world'): string {
    return header + (kind === 'mod' ? modSteps : worldSteps);
}

export function projectReadme(kind: 'mod' | 'world', name: string): string {
    const mod = kind === 'mod';
    return `# ${name}

ubichill の${mod ? ' mod ' : 'ワールド'}です。

\`\`\`bash
npm install
npm run dev
\`\`\`

## GitHub Pages に公開する

\`.github/workflows/pages.yml\` が、main に push するたびに、${
        mod
            ? 'ビルドして作者のアカウントで署名し、前の版を残したまま GitHub Pages に置いて、作者のサーバーのカタログに登録します。'
            : 'mod を固定して作者のアカウントで署名し、GitHub Pages に置いて、作者のユーザーページに登録します。'
    }

1. 手元で \`npx ubichill ci create --name="GitHub Actions: <owner>/<repo>"\` を実行し、ブラウザで承認します。表示された文字列を、リポジトリの Settings → Secrets and variables → Actions に Secret \`UBICHILL_CREDENTIALS\` として入れます。
2. ${
        mod
            ? '中身を変えたら `package.json` の `version` を上げます。公開した版は消さずに残り、同じ版を別の中身で公開しようとすると止まります。'
            : '`world.yaml` の `spec.thumbnail` に画像の URL を入れます（公開に必要です）。'
    }
3. \`package-lock.json\` もコミットして main に push します。最初の実行で \`gh-pages\` ブランチができます。
4. Settings → Pages の Source で「Deploy from a branch」・\`gh-pages\`・\`/ (root)\` を選びます。${
        mod ? 'Pages に出る前に登録しようとした最初の実行は失敗するので、Actions から再実行します。' : ''
    }

公開先は \`https://<owner>.github.io/<repo>\` です。独自ドメインなどで違うときは、リポジトリの変数 \`UBICHILL_PUBLIC_URL\` に入れます。

ユーザーページ・カタログに登録できなかったとき（登録の上限など）は、\`--require-registration\` で実行を失敗にしています。理由は実行のログに出ます。
`;
}
