/**
 * world.html のビルド出力（packages/frontend/dist-world）に SNS のものが入っていないことを確かめる。
 * scripts/architecture.mjs の world-app-closure はソースの import を辿る。こちらは実際に配るファイルを見る。
 *
 * - JS に SNS にしか無いもの（better-auth・backend の API の道）が無い
 * - 置かれたファイルが world.html・アイコン・assets だけ（public/ の同梱 mod などを配らない）
 *
 * 使い方: pnpm --filter @ubichill/frontend build:world のあとに node scripts/check-world-app-bundle.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isWorldDistFile, WORLD_DIST_DIR, worldDistFiles } from '../packages/cli/worldDist.mjs';

/** SNS にしか無いもの。world.html の JS に現れたら SNS のコードが混ざっている。 */
export const FORBIDDEN_MARKERS = ['better-auth', '/api/v1/'];

const files = worldDistFiles(WORLD_DIST_DIR);
const scripts = files.filter((file) => file.endsWith('.js'));
const strays = files.filter((file) => !isWorldDistFile(file));
const hits = scripts.flatMap((file) => {
    const source = readFileSync(join(WORLD_DIST_DIR, file), 'utf-8');
    return FORBIDDEN_MARKERS.filter((marker) => source.includes(marker)).map((marker) => `${file}: "${marker}"`);
});
for (const hit of hits) console.error(`❌ world.html の JS に SNS のコードが入っています: ${hit}`);
for (const stray of strays) console.error(`❌ world.html の出力に置いてはいけないファイルがあります: ${stray}`);
if (scripts.length === 0) console.error('❌ world.html の出力に JS がありません');
if (hits.length > 0 || strays.length > 0 || scripts.length === 0) process.exit(1);
console.log(`✅ world.html の出力 ${files.length} ファイル（JS ${scripts.length}）に SNS のものは無い`);
