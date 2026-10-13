/**
 * 設計の規則（scripts/architecture.mjs）をリポジトリの全ソースに当てる。違反があれば非ゼロで終わる（CI の lint で実行）。
 */
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { architectureRules, checkFile } from './architecture.mjs';

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
    for (const v of violations) console.error(`❌ [${v.rule}] ${v.path}: ${v.message}\n   理由: ${v.why}`);
    console.error(`\n設計の規則に ${violations.length} 件違反しています（scripts/architecture.mjs）。`);
    process.exit(1);
}
console.log(`✅ 設計の規則: ${files.length} ファイル、${rules.length} 件の規則に違反なし`);
