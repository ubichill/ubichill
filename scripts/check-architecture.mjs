/**
 * 設計の規則（scripts/architecture.mjs）をリポジトリの全ソースに当てる。違反があれば非ゼロで終わる（CI の lint で実行）。
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTerminal, debugFromEnv, processIO } from '@ubichill/terminal';
import { architectureRules, checkFile, WORLD_APP_ALLOWED, worldAppClosure } from './architecture.mjs';

const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf-8');

// loader の Node 専用の入口（package.json の exports の「.」以外）は、ブラウザでは読み込まれない
const loaderExports = JSON.parse(read('packages/loader/package.json')).exports ?? {};
const loaderNodeOnly = new Set(
    Object.entries(loaderExports)
        .filter(([entry, target]) => entry !== '.' && typeof target === 'string')
        .map(([, target]) => `packages/loader/${target.replace(/^\.\//, '')}`),
);

const files = globSync(['packages/*/src/**/*.{ts,tsx,mts}', 'mods/*/src/**/*.{ts,tsx}'], {
    cwd: root,
    exclude: (name) => name === 'node_modules' || name === 'dist' || name === 'styled-system',
});
const rules = architectureRules({ loaderNodeOnly });
const violations = files.sort().flatMap((path) => checkFile(path, read(path), rules));

if (violations.length > 0) {
    term.error(
        [
            `設計の規則に ${violations.length} 件違反しています`,
            ...violations.flatMap((v) => [`- [${v.rule}] ${v.path}: ${v.message}`, `  理由: ${v.why}`]),
        ].join('\n'),
        'scripts/architecture.mjs',
    );
    process.exit(1);
}
term.success('設計の規則に違反なし', `${files.length} ファイル  規則 ${rules.length} 件`);

// world.html から辿れるコードが SNS を読み込まないこと（直接の import だけでなく helper 越しも辿る）
const closure = worldAppClosure({ read, exists: (path) => existsSync(new URL(`../${path}`, import.meta.url)) });
if (closure.violations.length > 0) {
    term.error(
        [
            `world.html から辿れる ${closure.violations.length} ファイルが許可の外にあります`,
            ...closure.violations.flatMap((v) => [`- ${v.path}`, `  経路: ${v.chain.join('\n    → ')}`]),
            `理由: world.html は SNS（認証・router・backend API）無しでワールドを動かす。辿ってよいのは packages/frontend/src の ${WORLD_APP_ALLOWED.join(', ')} だけ`,
        ].join('\n'),
        'world-app-closure',
    );
    process.exit(1);
}
term.success('world-app-closure: world.html から辿れるファイルはすべて許可の中', `${closure.visited.length} ファイル`);
