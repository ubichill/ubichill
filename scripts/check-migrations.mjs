/**
 * packages/db/drizzle のマイグレーションの順（scripts/migrations.mjs）を確かめる。違反があれば非ゼロで終わる（CI の lint で実行）。
 * 使い方: node scripts/check-migrations.mjs [drizzle のディレクトリ]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerminal, debugFromEnv, processIO } from '@ubichill/terminal';
import { checkMigrations } from './migrations.mjs';

const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
const dir = resolve(process.argv[2] ?? fileURLToPath(new URL('../packages/db/drizzle', import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf-8'));

const journal = readJson(join(dir, 'meta/_journal.json'));
const snapshots = new Map(
    readdirSync(join(dir, 'meta'))
        .filter((name) => name.endsWith('_snapshot.json'))
        .map((name) => [name.split('_')[0], readJson(join(dir, 'meta', name))]),
);
const sqlTags = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length));

const violations = checkMigrations(journal, snapshots, sqlTags);
if (violations.length > 0) {
    term.error(
        [
            `マイグレーションの順に ${violations.length} 件問題があります`,
            ...violations.map((v) => `- ${v}`),
            '直し方: main を取り込んでから自分のマイグレーションを消し、drizzle-kit generate で作り直す',
        ].join('\n'),
        'scripts/migrations.mjs',
    );
    process.exit(1);
}
term.success('マイグレーションの順に問題なし', `${journal.entries.length} 件`);
