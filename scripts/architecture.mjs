/**
 * 設計の規則（アーキテクチャの約束）を機械的に確かめる純粋なロジック。CI は scripts/check-architecture.mjs で全ファイルに当てる。
 *
 * 規則を足すときは、何を守るのかを `why` に書く（落ちたときに、直し方と規則の意味が分かるように）。
 * コメントの中の文字列は見ない（説明に `/api/v1` と書いても違反にしない）。
 */

/** コメントを除いたソース（文字列の中の `//`（URL など）は残す）。 */
export function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
        .split('\n')
        .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
        .join('\n');
}

/** import / export from / import() / require() で読み込むモジュール名。 */
export function importedModules(source) {
    const code = stripComments(source);
    const patterns = [
        /\bfrom\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /^\s*import\s*['"]([^'"]+)['"]/gm,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    return [...new Set(patterns.flatMap((re) => [...code.matchAll(re)].map((m) => m[1])))];
}

const isTest = (path) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes('/test/');

/**
 * 規則の一覧。`applies` で対象のファイルを決め、`check` が違反の説明を返す（無ければ空）。
 * @param {{ loaderNodeOnly: ReadonlySet<string> }} context
 */
export function architectureRules(context) {
    return [
        {
            id: 'host-runs-mods-without-backend',
            why: 'Host は SNS backend の無い単体モードでも mod を動かす。mod の取得・確認・実行の経路から、自分のオリジンの API に頼らない（#229）',
            applies: (path) =>
                !isTest(path) &&
                (path.startsWith('packages/frontend/src/mods/') ||
                    path.startsWith('packages/loader/src/') ||
                    path.startsWith('packages/sandbox/src/') ||
                    path.startsWith('packages/react/src/')),
            check: (source) => {
                const code = stripComments(source);
                const imports = importedModules(source).filter((m) => /(^|\/)lib\/api$/.test(m));
                const literals = [...code.matchAll(/['"`][^'"`\n]*\/api\/v1\b[^'"`\n]*['"`]/g)].map((m) => m[0]);
                return [
                    ...imports.map((m) => `Host の API の入口（${m}）を読み込んでいます`),
                    ...literals.map((l) => `Host の API（${l}）を直接呼んでいます`),
                ];
            },
        },
        {
            id: 'shared-is-pure',
            why: '@ubichill/shared は全層で共有する純粋な知識。Node・DOM・ネットワークに依存しない（ブラウザ・backend・CLI が同じ規則を使えるように）',
            applies: (path) => path.startsWith('packages/shared/src/') && !isTest(path),
            check: (source) => {
                const code = stripComments(source);
                const nodeImports = importedModules(source).filter((m) => m.startsWith('node:'));
                const dom = [...code.matchAll(/\b(window|document|localStorage|sessionStorage)\s*\.|\bfetch\s*\(/g)].map(
                    (m) => m[0],
                );
                return [
                    ...nodeImports.map((m) => `Node のモジュール（${m}）を読み込んでいます`),
                    ...dom.map((d) => `環境に依存するもの（${d.trim()}）を使っています`),
                ];
            },
        },
        {
            id: 'loader-main-is-browser-safe',
            why: '@ubichill/loader の既定の入口はブラウザでも読み込む。Node 専用の処理は package.json の別の入口（./install-dependencies など）に分ける',
            applies: (path) =>
                path.startsWith('packages/loader/src/') && !isTest(path) && !context.loaderNodeOnly.has(path),
            check: (source) =>
                importedModules(source)
                    .filter((m) => m.startsWith('node:'))
                    .map((m) => `Node のモジュール（${m}）を読み込んでいます（Node 専用なら package.json の exports に別の入口を作る）`),
        },
        {
            id: 'backend-runs-built-packages-only',
            why: 'backend は pnpm deploy で配る（node_modules の中では TypeScript のソースを実行できない）。ソースのまま配るパッケージ・ブラウザ向けのパッケージに依存しない',
            applies: (path) => path.startsWith('packages/backend/src/') && !isTest(path),
            check: (source) =>
                importedModules(source)
                    .filter((m) => /^@ubichill\/(frontend|react|sandbox|loader|ui-renderer|sdk)(\/|$)/.test(m))
                    .map((m) => `${m} に依存しています`),
        },
        {
            id: 'mods-use-public-sdk-only',
            why: 'mod は npm で公開している ubichill パッケージだけに依存する（リポジトリの外の mod と同じ条件でビルドできるように）',
            applies: (path) => /^mods\/[^/]+\/src\//.test(path),
            check: (source) =>
                importedModules(source)
                    .filter((m) => m.startsWith('@ubichill/'))
                    .map((m) => `内部パッケージ（${m}）を読み込んでいます。公開パッケージ 'ubichill' を使ってください`),
        },
    ];
}

/** 1 ファイルに規則を当てる。 */
export function checkFile(path, source, rules) {
    return rules
        .filter((rule) => rule.applies(path))
        .flatMap((rule) => rule.check(source).map((message) => ({ rule: rule.id, why: rule.why, path, message })));
}
