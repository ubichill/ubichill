#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

interface JournalEntry {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
}

/**
 * スキーマが既に存在するが migration tracking がない既存 DB を検出し、
 * 全 migration を「適用済み」としてマークする（SQL は実行しない）。
 *
 * Drizzle migrate 導入前に作られた DB への対処。baseline 後は新規 migration のみ実行される。
 */
async function baselineIfNeeded(client: postgres.Sql): Promise<void> {
    const schemaExists = await client<[{ exists: boolean }]>`
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'users'
        ) AS exists
    `.then((r) => r[0].exists);

    if (!schemaExists) return;

    const trackingExists = await client<[{ exists: boolean }]>`
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
        ) AS exists
    `.then((r) => r[0].exists);

    const migrationCount = trackingExists
        ? await client<[{ count: string }]>`SELECT COUNT(*) AS count FROM drizzle.__drizzle_migrations`.then((r) =>
              Number(r[0].count),
          )
        : 0;

    if (migrationCount > 0) return;

    console.log('⚠️  Existing schema detected without migration tracking. Running baseline...');

    const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf-8')) as {
        entries: JournalEntry[];
    };

    await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
    await client`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `;

    for (const entry of journal.entries) {
        const sql = readFileSync(join(migrationsFolder, `${entry.tag}.sql`), 'utf-8');
        const hash = createHash('sha256').update(sql).digest('hex');
        await client`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${entry.when})
            ON CONFLICT DO NOTHING
        `;
        console.log(`  ✓ Baselined: ${entry.tag} (${hash.slice(0, 8)}...)`);
    }

    console.log('✅ Baseline complete.');
}

async function waitForPostgres(connectionString: string, maxAttempts = 30): Promise<postgres.Sql> {
    for (let i = 1; i <= maxAttempts; i++) {
        const client = postgres(connectionString, { max: 1, prepare: false, connect_timeout: 5 });
        try {
            await client`SELECT 1`;
            return client;
        } catch {
            await client.end({ timeout: 1 }).catch(() => undefined);
            if (i === maxAttempts) throw new Error(`PostgreSQL not ready after ${maxAttempts} attempts`);
            console.log(`⏳ Waiting for PostgreSQL... (${i}/${maxAttempts})`);
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    throw new Error('unreachable');
}

async function main(): Promise<void> {
    console.log(`🔄 Drizzle migrate: ${migrationsFolder}`);
    let client: postgres.Sql | undefined;
    try {
        client = await waitForPostgres(connectionString as string);
        await baselineIfNeeded(client);
        const db = drizzle(client);
        await migrate(db, { migrationsFolder });
        console.log('✅ Migrations applied');
    } catch (err) {
        console.error('❌ Migration failed:', err);
        process.exitCode = 1;
    } finally {
        await client?.end({ timeout: 5 });
    }
}

void main();
