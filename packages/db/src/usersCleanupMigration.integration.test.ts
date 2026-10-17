import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HANDLE_PATTERN, HandleSchema } from '@ubichill/shared';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './index';

/**
 * 0021_users_cleanup の結合テスト。DATABASE_URL の Postgres に使い捨ての DB を作り、0020 まで当てた DB に
 * handle なし・username あり・profile_image_url ありのユーザーを入れてから 0021 を当てる。DATABASE_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL;
const MIGRATIONS = path.resolve(__dirname, '../drizzle');
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const NO_HANDLE_COUNT = 200;

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

interface UserRow {
    id: string;
    handle: string | null;
    image: string | null;
}

describe.skipIf(!RUN)('0021_users_cleanup（DB 統合）', () => {
    const name = `ubichill_users_cleanup_${Date.now().toString(36)}`;
    const upTo0020 = RUN ? migrationsUpTo('0020_author_keys') : '';
    const admin = RUN ? createDatabase(process.env.DATABASE_URL ?? '') : undefined;
    const state: { scratch?: ReturnType<typeof createDatabase>; rows: UserRow[]; columns: string[] } = {
        rows: [],
        columns: [],
    };
    const db = (): Database => {
        if (!state.scratch) throw new Error('DB を作っていません');
        return state.scratch.db;
    };
    const byId = (id: string): UserRow | undefined => state.rows.find((r) => r.id === id);

    beforeAll(async () => {
        await admin?.client.unsafe(`CREATE DATABASE "${name}"`);
        await admin?.client.unsafe(`ALTER DATABASE "${name}" SET timezone TO 'UTC'`);
        const url = new URL(process.env.DATABASE_URL ?? '');
        url.pathname = `/${name}`;
        state.scratch = createDatabase(url.toString());
        await migrate(db(), { migrationsFolder: upTo0020 });

        const noHandle = Array.from({ length: NO_HANDLE_COUNT }, (_, i) => `nh-${i}`);
        await db().execute(sql`
            INSERT INTO users (id, name, email, handle, username, image, profile_image_url) VALUES
                ('keep', 'Keep', 'keep@example.com', 'user_keep', 'Keep Name', NULL, NULL),
                ('both', 'Both', 'both@example.com', NULL, NULL, 'https://img.example/better-auth.png', 'https://img.example/old.png'),
                ('old-only', 'Old', 'old@example.com', NULL, 'old_name', NULL, '  https://img.example/old-only.png '),
                ('blank-image', 'Blank', 'blank@example.com', 'blank_image', NULL, '', 'https://img.example/blank.png'),
                ('blank-old', 'BlankOld', 'blank-old@example.com', 'blank_old', NULL, NULL, '   '),
                (${SYSTEM_USER_ID}, 'System', 'system@ubichill.local', NULL, NULL, NULL, NULL)
        `);
        await db().execute(sql`
            INSERT INTO users (id, name, email, username)
            SELECT id, id, id || '@example.com', 'Username ' || id
            FROM unnest(${sql.raw(`ARRAY[${noHandle.map((id) => `'${id}'`).join(',')}]`)}) AS id
        `);

        await migrate(db(), { migrationsFolder: MIGRATIONS });
        state.rows = [...(await db().execute<UserRow>(sql`SELECT id, handle, image FROM users`))];
        state.columns = (
            await db().execute<{ column_name: string }>(
                sql`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'`,
            )
        ).map((r) => r.column_name);
    }, 60_000);

    afterAll(async () => {
        await state.scratch?.client.end({ timeout: 5 });
        await admin?.client.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin?.client.end({ timeout: 5 });
        if (upTo0020) rmSync(upTo0020, { recursive: true, force: true });
    });

    it('すべてのユーザーに handle があり、重ならず、システムユーザー以外は登録と同じ規則（予約語を含む）を満たす', () => {
        const handles = state.rows.map((r) => r.handle);
        expect(state.rows).toHaveLength(NO_HANDLE_COUNT + 6);
        expect(handles.every((h) => h !== null && HANDLE_PATTERN.test(h))).toBe(true);
        expect(new Set(handles).size).toBe(handles.length);
        const users = state.rows.filter((r) => r.id !== SYSTEM_USER_ID);
        expect(users.filter((r) => !HandleSchema.safeParse(r.handle).success)).toEqual([]);
    });

    it('handle が無かったユーザーには user_ + 16 進 12 桁を振り、既存の handle は変えない', () => {
        expect(byId('keep')?.handle).toBe('user_keep');
        expect(byId('blank-image')?.handle).toBe('blank_image');
        for (const id of ['both', 'old-only', 'nh-0', `nh-${NO_HANDLE_COUNT - 1}`]) {
            expect(byId(id)?.handle).toMatch(/^user_[0-9a-f]{12}$/);
        }
    });

    it('システムユーザーは予約語の system になる（一般の登録では取れない名前なので、利用者の ID と重ならない）', () => {
        expect(byId(SYSTEM_USER_ID)?.handle).toBe('system');
    });

    it('画像は image が空のときだけ profile_image_url を移す（前後の空白は除く）', () => {
        expect(byId('both')?.image).toBe('https://img.example/better-auth.png');
        expect(byId('old-only')?.image).toBe('https://img.example/old-only.png');
        expect(byId('blank-image')?.image).toBe('https://img.example/blank.png');
        expect(byId('blank-old')?.image).toBeNull();
        expect(byId('keep')?.image).toBeNull();
    });

    it('username・profile_image_url の列が消え、handle は NOT NULL になる', async () => {
        expect(state.columns).not.toContain('username');
        expect(state.columns).not.toContain('profile_image_url');
        await expect(
            db().execute(sql`INSERT INTO users (id, name, email) VALUES ('after', 'After', 'after@example.com')`),
        ).rejects.toThrow();
    });
});
