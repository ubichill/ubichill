import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseNotificationObject } from '@ubichill/shared';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './index';

/**
 * 0026_notifications の結合テスト。0025 まで当てた使い捨ての DB に申請中・承認済みのフレンドを入れてから 0026 を当て、
 * 申請中のものだけが申請された人の Follow の通知になるかを見る。DATABASE_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL;
const MIGRATIONS = path.resolve(__dirname, '../drizzle');

function migrationsUpTo(tag: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'ubichill-migrations-'));
    cpSync(MIGRATIONS, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as { entries: Array<{ tag: string; idx: number }> };
    const last = journal.entries.find((e) => e.tag === tag);
    if (!last) throw new Error(`${tag} が journal にありません`);
    writeFileSync(
        journalPath,
        JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.idx <= last.idx) }),
    );
    return dir;
}

type Row = { recipient_id: string; actor_user_id: string; type: string; object: unknown; created_at: Date };

describe.skipIf(!RUN)('0026_notifications（DB 統合）', () => {
    const name = `ubichill_notifications_${Date.now().toString(36)}`;
    const admin = RUN ? createDatabase(process.env.DATABASE_URL ?? '') : undefined;
    const state: { scratch?: ReturnType<typeof createDatabase>; rows: Row[] } = { rows: [] };
    const db = (): Database => {
        if (!state.scratch) throw new Error('DB を作っていません');
        return state.scratch.db;
    };

    beforeAll(async () => {
        await admin?.client.unsafe(`CREATE DATABASE "${name}"`);
        const url = new URL(process.env.DATABASE_URL ?? '');
        url.pathname = `/${name}`;
        state.scratch = createDatabase(url.toString());
        await migrate(db(), { migrationsFolder: migrationsUpTo('0025_db_cleanup_drop_columns') });
        await db().execute(sql`
            INSERT INTO users (id, name, email, handle) VALUES
                ('a', 'A', 'a@example.com', 'user_a'), ('b', 'B', 'b@example.com', 'user_b'),
                ('c', 'C', 'c@example.com', 'user_c')
        `);
        await db().execute(sql`
            INSERT INTO user_friends (user_id, friend_id, status, created_at) VALUES
                ('a', 'b', 'pending', '2026-10-01T00:00:00.123456Z'),
                ('b', 'c', 'accepted', '2026-10-01T00:00:00Z'),
                ('c', 'a', 'pending', '2026-10-02T00:00:00Z')
        `);
        await migrate(db(), { migrationsFolder: MIGRATIONS });
        state.rows = [
            ...(await db().execute<Row>(
                sql`SELECT recipient_id, actor_user_id, type, object, created_at FROM notifications ORDER BY recipient_id`,
            )),
        ];
    });

    afterAll(async () => {
        await state.scratch?.client.end();
        await admin?.client.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
        await admin?.client.end();
    });

    it('申請中のものだけが、申請された人への Follow になる', () => {
        expect(state.rows.map((r) => [r.recipient_id, r.actor_user_id, r.type])).toEqual([
            ['a', 'c', 'Follow'],
            ['b', 'a', 'Follow'],
        ]);
    });

    it('object は shared の Follow の形で、時刻はミリ秒に丸める', () => {
        const toB = state.rows.find((r) => r.recipient_id === 'b');
        expect(parseNotificationObject('Follow', toB?.object)).toEqual({ type: 'Person', id: 'b' });
        expect(new Date(toB?.created_at ?? 0).toISOString()).toBe('2026-10-01T00:00:00.123Z');
    });

    it('種類と actor の制約が効く', async () => {
        await expect(
            db().execute(sql`INSERT INTO notifications (id, recipient_id, type, actor_user_id, object, dedupe_key)
                VALUES ('x1', 'a', 'Announce', 'b', '{}', 'k1')`),
        ).rejects.toThrow();
        await expect(
            db().execute(sql`INSERT INTO notifications (id, recipient_id, type, actor_user_id, actor_uri, object, dedupe_key)
                VALUES ('x2', 'a', 'Like', 'b', 'https://r.example/u', '{}', 'k2')`),
        ).rejects.toThrow();
        await expect(
            db().execute(sql`INSERT INTO notifications (id, recipient_id, type, object, dedupe_key)
                VALUES ('x3', 'a', 'Like', '{}', 'k3')`),
        ).rejects.toThrow();
    });
});
