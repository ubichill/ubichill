import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './index';

/**
 * 0027_user_profile の結合テスト。0026 まで当てた使い捨ての DB にユーザーを入れてから 0027 を当て、
 * users が変わらないこと、プロフィール・画像の表が制約どおりに働くかを見る。DATABASE_URL がある時だけ走る。
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

describe.skipIf(!RUN)('0027_user_profile（DB 統合）', () => {
    const name = `ubichill_user_profile_${Date.now().toString(36)}`;
    const admin = RUN ? createDatabase(process.env.DATABASE_URL ?? '') : undefined;
    const state: { scratch?: ReturnType<typeof createDatabase> } = {};
    const db = (): Database => {
        if (!state.scratch) throw new Error('DB を作っていません');
        return state.scratch.db;
    };

    beforeAll(async () => {
        await admin?.client.unsafe(`CREATE DATABASE "${name}"`);
        const url = new URL(process.env.DATABASE_URL ?? '');
        url.pathname = `/${name}`;
        state.scratch = createDatabase(url.toString());
        await migrate(db(), { migrationsFolder: migrationsUpTo('0026_notifications') });
        await db().execute(sql`
            INSERT INTO users (id, name, email, handle, image, bio) VALUES
                ('a', 'A', 'a@example.com', 'user_a', 'https://oauth.example/a.png', 'よろしく'),
                ('b', 'B', 'b@example.com', 'user_b', NULL, NULL)
        `);
        await migrate(db(), { migrationsFolder: MIGRATIONS });
    });

    afterAll(async () => {
        await state.scratch?.client.end();
        await admin?.client.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin?.client.end();
    });

    it('users は変えない（列も既存の値も同じ）', async () => {
        const rows = await db().execute<{ id: string; image: string | null; bio: string | null }>(
            sql`SELECT id, image, bio FROM users ORDER BY id`,
        );
        expect([...rows]).toEqual([
            { id: 'a', image: 'https://oauth.example/a.png', bio: 'よろしく' },
            { id: 'b', image: null, bio: null },
        ]);
        const columns = await db().execute<{ column_name: string }>(
            sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('status', 'links', 'languages', 'banner_image')`,
        );
        expect([...columns]).toEqual([]);
    });

    it('プロフィールの行は 1 人 1 行。リンク・言語を書かなければ空の配列', async () => {
        await db().execute(sql`INSERT INTO user_profiles (user_id, status) VALUES ('a', '作業中')`);
        const [row] = await db().execute<{ links: unknown; languages: unknown; banner_image: string | null }>(
            sql`SELECT links, languages, banner_image FROM user_profiles WHERE user_id = 'a'`,
        );
        expect(row).toEqual({ links: [], languages: [], banner_image: null });
        await expect(db().execute(sql`INSERT INTO user_profiles (user_id) VALUES ('a')`)).rejects.toThrow();
        await expect(db().execute(sql`INSERT INTO user_profiles (user_id) VALUES ('ghost')`)).rejects.toThrow();
    });

    it('画像は利用者・種類ごとに 1 枚。種類は avatar / banner だけ', async () => {
        const insert = (kind: string) =>
            db().execute(sql`
                INSERT INTO profile_images (user_id, kind, hash, content_type, bytes, width, height)
                VALUES ('a', ${kind}, 'h', 'image/webp', ${Buffer.from([1, 2, 3])}, 512, 512)
            `);
        await insert('avatar');
        await insert('banner');
        await expect(insert('avatar')).rejects.toThrow();
        await expect(insert('background')).rejects.toThrow();
    });

    it('ユーザーを消すとプロフィールと画像も消える', async () => {
        await db().execute(sql`DELETE FROM users WHERE id = 'a'`);
        const [row] = await db().execute<{ images: number; profiles: number }>(sql`
            SELECT (SELECT count(*)::int FROM profile_images WHERE user_id = 'a') AS images,
                   (SELECT count(*)::int FROM user_profiles WHERE user_id = 'a') AS profiles
        `);
        expect(row).toEqual({ images: 0, profiles: 0 });
    });
});
