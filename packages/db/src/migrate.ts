#!/usr/bin/env node
/**
 * Drizzle マイグレーション実行スクリプト。
 *
 * 用途:
 *  - ローカル: `pnpm db:migrate` (DATABASE_URL=postgresql://... が前提)
 *  - K8s: Helm の pre-install/pre-upgrade Job が backend イメージから本スクリプトを呼ぶ
 *
 * `drizzle/` ディレクトリは本ファイルの 1 階層上 (= db パッケージのルート) にある。
 * dev (src/migrate.ts) でも build 後 (dist/migrate.js) でも `import.meta.url` 起点で
 * 解決できるため、CWD に依存しない。
 */
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL is required');
    process.exit(1);
}

// CJS の __dirname を使う (このパッケージは type:"module" ではないため import.meta 不可)。
// dev: src/migrate.ts (tsx) → __dirname = packages/db/src → ../drizzle ✓
// prod: dist/migrate.js (node) → __dirname = packages/db/dist → ../drizzle ✓
const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_FOLDER ?? resolve(__dirname, '..', 'drizzle');

async function main(): Promise<void> {
    console.log(`🔄 Drizzle migrate: ${migrationsFolder}`);
    const client = postgres(connectionString as string, { max: 1, prepare: false });
    try {
        const db = drizzle(client);
        await migrate(db, { migrationsFolder });
        console.log('✅ Migrations applied');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exitCode = 1;
    } finally {
        await client.end({ timeout: 5 });
    }
}

void main();
