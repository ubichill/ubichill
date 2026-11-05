/**
 * `world.html` のビルド成果物（Vite の manifest から辿れる chunk）に SNS のコードが入っていないことを確かめる。
 * scripts/architecture.mjs の world-app-closure はソースの import を辿る。こちらは実際に配る JS を見る
 * （bundler の共通 chunk の切り方で SNS の chunk を共有してしまった場合もここで分かる）。
 *
 * 使い方: pnpm --filter @ubichill/frontend build のあとに node scripts/check-world-app-bundle.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { worldScripts } from '../packages/cli/worldDist.mjs';

const dist = fileURLToPath(new URL('../packages/frontend/dist/', import.meta.url));
const manifestPath = `${dist}.vite/manifest.json`;
if (!existsSync(manifestPath)) {
    console.error(`❌ ${manifestPath} がありません。先に pnpm --filter @ubichill/frontend build を実行してください`);
    process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

/** SNS にしか無いもの。world.html の chunk に現れたら SNS のコードが混ざっている。 */
export const FORBIDDEN_MARKERS = ['better-auth', '/api/v1/'];

const files = worldScripts(manifest, dist);
if (files.length === 0) {
    console.error('❌ manifest に world.html のエントリがありません');
    process.exit(1);
}
const hits = files.flatMap((file) => {
    const source = readFileSync(`${dist}${file}`, 'utf-8');
    return FORBIDDEN_MARKERS.filter((marker) => source.includes(marker)).map((marker) => `${file}: "${marker}"`);
});
if (hits.length > 0) {
    for (const hit of hits) console.error(`❌ world.html の chunk に SNS のコードが入っています: ${hit}`);
    process.exit(1);
}
console.log(`✅ world.html の chunk ${files.length} 個に SNS のコードは無い`);
