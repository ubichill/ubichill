import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { worldContentHash } from '@ubichill/shared';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from './index';
import { backfillWorldContentHashes } from './worldContentHashBackfill';

/**
 * 0023_world_versions の結合テスト。DATABASE_URL の Postgres に使い捨ての DB を作り、0022 まで当てた DB に
 * 公開中・下書きあり・未公開・署名あり/なし・ID をそろえられない行を入れてから 0023 と content_hash の埋め戻しを当てる。
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

const sha256Crypto = {
    sha256Base64: async (text: string) => createHash('sha256').update(text, 'utf8').digest('base64'),
    verifyEd25519: async () => false,
};

const def = (name: string, label: string, version = '1.0.0') => ({
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    metadata: { name, version },
    // 正規化で落としやすい値（小数・Unicode・入れ子の順序）を混ぜる
    spec: { displayName: label, capacity: { max: 4, default: 2 }, ratio: 1.5, note: '日本語   😀' },
});
const LOCK = { lockVersion: 1, mods: { 'pen:pen': { url: 'https://example.com/pen.js', integrity: 'sha256-x' } } };
const SIG = (n: string) => ({ v: 1, kind: 'world', subject: n, contentHash: 'sha256-fake', signature: 'sig' });
const T = (s: string) => new Date(`2026-10-0${s}T00:00:00Z`);

/** 0022 の worlds の 1 行。 */
type OldWorld = {
    id: string;
    name: string;
    world_name: string;
    version: string;
    definition: unknown;
    lock: unknown;
    signature: unknown;
    draft_definition: unknown;
    draft_lock: unknown;
    draft_updated_at: Date | null;
    updated_at: Date;
};

const OLD: OldWorld[] = [
    {
        // 公開中（lock・署名あり）。id を name にそろえる
        id: 'Pub_ID-aaaaaaaaaaaaaa',
        name: 'pubname00000000000000',
        world_name: 'pub',
        version: '1.0.0',
        definition: def('pub', '公開中'),
        lock: LOCK,
        signature: SIG('pub'),
        draft_definition: null,
        draft_lock: null,
        draft_updated_at: null,
        updated_at: T('1'),
    },
    {
        // 公開中 + 下書き
        id: 'Draft_ID-aaaaaaaaaaaa',
        name: 'draftname000000000000',
        world_name: 'drafted',
        version: '1.0.0',
        definition: def('drafted', '公開中'),
        lock: null,
        signature: SIG('drafted'),
        draft_definition: def('drafted', '編集中', '1.1.0'),
        draft_lock: LOCK,
        draft_updated_at: T('3'),
        updated_at: T('2'),
    },
    {
        // 未公開（署名なし）
        id: 'Unsigned_ID-aaaaaaaaa',
        name: 'unsignedname000000000',
        world_name: 'unsigned',
        version: '0.1.0',
        definition: def('unsigned', '署名なし', '0.1.0'),
        lock: LOCK,
        signature: null,
        draft_definition: null,
        draft_lock: null,
        draft_updated_at: null,
        updated_at: T('4'),
    },
    {
        // 署名なしなのに下書きがある（今のコードでは起きない）。作者の新しい方を残す
        id: 'Odd_ID-aaaaaaaaaaaaaa',
        name: 'oddname00000000000000',
        world_name: 'odd',
        version: '0.1.0',
        definition: def('odd', '古い'),
        lock: null,
        signature: null,
        draft_definition: def('odd', '新しい', '0.2.0'),
        draft_lock: null,
        draft_updated_at: T('6'),
        updated_at: T('5'),
    },
    {
        // name が 21 文字を超える（0013 より前の形）。id はそのまま
        id: 'Long_ID-aaaaaaaaaaaaa',
        name: 'legacy-world-name-longer-than-21',
        world_name: 'legacy',
        version: '1.0.0',
        definition: def('legacy', '昔の'),
        lock: null,
        signature: SIG('legacy'),
        draft_definition: null,
        draft_lock: null,
        draft_updated_at: null,
        updated_at: T('7'),
    },
    {
        // name がほかの行の id と同じ（重なるので id はそのまま）
        id: 'Collide_ID-aaaaaaaaaa',
        name: 'Pub_ID-aaaaaaaaaaaaaa',
        world_name: 'collide',
        version: '1.0.0',
        definition: def('collide', '重なる'),
        lock: null,
        signature: null,
        draft_definition: null,
        draft_lock: null,
        draft_updated_at: null,
        updated_at: T('8'),
    },
];
const newIdOf = (old: OldWorld): string =>
    old.name.length <= 21 && !OLD.some((o) => o.id === old.name) ? old.name : old.id;
const byWorldName = (n: string): OldWorld => {
    const row = OLD.find((o) => o.world_name === n);
    if (!row) throw new Error(n);
    return row;
};

type VersionRow = {
    id: string;
    world_id: string;
    version: string;
    definition: unknown;
    lock: unknown;
    signature: unknown;
    content_hash: string | null;
    published_at: string;
};
type DraftRow = { world_id: string; definition: unknown; lock: unknown; updated_at: string };
/** 生の SQL の結果の時刻は文字列で返る。 */
const ms = (value: string | undefined): number => (value ? new Date(value).getTime() : Number.NaN);

describe.skipIf(!RUN)('0023_world_versions（DB 統合）', () => {
    const name = `ubichill_world_versions_${Date.now().toString(36)}`;
    const upTo0022 = RUN ? migrationsUpTo('0022_users_drop_columns') : '';
    // 0023 だけを確かめる（後続のマイグレーションは古い列を消す）
    const upTo0023 = RUN ? migrationsUpTo('0023_world_versions') : '';
    const admin = RUN ? createDatabase(process.env.DATABASE_URL ?? '') : undefined;
    const state: {
        scratch?: ReturnType<typeof createDatabase>;
        worlds: Array<OldWorld & { current_version_id: string | null }>;
        versions: VersionRow[];
        drafts: DraftRow[];
        hashesBeforeBackfill: Array<string | null>;
        backfilled: number;
    } = { worlds: [], versions: [], drafts: [], hashesBeforeBackfill: [], backfilled: 0 };
    const db = (): Database => {
        if (!state.scratch) throw new Error('DB を作っていません');
        return state.scratch.db;
    };
    const versionOf = (worldId: string) => state.versions.find((v) => v.world_id === worldId);
    const draftOf = (worldId: string) => state.drafts.find((d) => d.world_id === worldId);

    beforeAll(async () => {
        await admin?.client.unsafe(`CREATE DATABASE "${name}"`);
        await admin?.client.unsafe(`ALTER DATABASE "${name}" SET timezone TO 'UTC'`);
        const url = new URL(process.env.DATABASE_URL ?? '');
        url.pathname = `/${name}`;
        state.scratch = createDatabase(url.toString());
        await migrate(db(), { migrationsFolder: upTo0022 });

        await db().execute(sql`
            INSERT INTO users (id, name, email, handle) VALUES ('u1', 'Alice', 'alice@example.com', 'alice_w')
        `);
        for (const w of OLD) {
            await db().execute(sql`
                INSERT INTO worlds (id, author_id, name, world_name, version, definition, lock, signature,
                                    draft_definition, draft_lock, draft_updated_at, created_at, updated_at)
                VALUES (${w.id}, 'u1', ${w.name}, ${w.world_name}, ${w.version}, ${JSON.stringify(w.definition)}::jsonb,
                        ${w.lock === null ? null : JSON.stringify(w.lock)}::jsonb,
                        ${w.signature === null ? null : JSON.stringify(w.signature)}::jsonb,
                        ${w.draft_definition === null ? null : JSON.stringify(w.draft_definition)}::jsonb,
                        ${w.draft_lock === null ? null : JSON.stringify(w.draft_lock)}::jsonb,
                        ${w.draft_updated_at?.toISOString() ?? null}::timestamptz, ${T('1').toISOString()}::timestamptz,
                        ${w.updated_at.toISOString()}::timestamptz)
            `);
        }
        // 以前の名前（別名）はワールドの id を指す
        await db().execute(sql`
            INSERT INTO world_name_aliases (author_id, name, world_id) VALUES
                ('u1', 'pub-old', ${byWorldName('pub').id}), ('u1', 'legacy-old', ${byWorldName('legacy').id})
        `);
        await db().execute(sql`
            INSERT INTO instances (id, world_ref, leader_id) VALUES ('inst-1', 'https://example.com/api/v1/authors/alice_w/worlds/pub.yaml', 'u1')
        `);

        await migrate(db(), { migrationsFolder: upTo0023 });
        state.hashesBeforeBackfill = (
            await db().execute<{ content_hash: string | null }>(sql`SELECT content_hash FROM world_versions`)
        ).map((r) => r.content_hash);
        state.backfilled = await backfillWorldContentHashes(db());
        state.worlds = [
            ...(await db().execute<OldWorld & { current_version_id: string | null }>(sql`SELECT * FROM worlds`)),
        ];
        state.versions = [...(await db().execute<VersionRow>(sql`SELECT * FROM world_versions`))];
        state.drafts = [...(await db().execute<DraftRow>(sql`SELECT * FROM world_drafts`))];
    }, 60_000);

    afterAll(async () => {
        await state.scratch?.client.end({ timeout: 5 });
        await admin?.client.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin?.client.end({ timeout: 5 });
        for (const dir of [upTo0022, upTo0023]) if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('id を以前の name にそろえる（API の id が変わらない）。収まらない・重なる行は id のまま', () => {
        expect(state.worlds.map((w) => w.id).sort()).toEqual(OLD.map(newIdOf).sort());
        expect(newIdOf(byWorldName('pub'))).toBe('pubname00000000000000');
        expect(newIdOf(byWorldName('legacy'))).toBe('Long_ID-aaaaaaaaaaaaa');
        expect(newIdOf(byWorldName('collide'))).toBe('Collide_ID-aaaaaaaaaa');
    });

    it('別名は新しい id を指し直す（外部キーも張り直してある）', async () => {
        const aliases = await db().execute<{ name: string; world_id: string }>(
            sql`SELECT name, world_id FROM world_name_aliases ORDER BY name`,
        );
        expect([...aliases]).toEqual([
            { name: 'legacy-old', world_id: 'Long_ID-aaaaaaaaaaaaa' },
            { name: 'pub-old', world_id: 'pubname00000000000000' },
        ]);
        await expect(
            db().execute(sql`INSERT INTO world_name_aliases (author_id, name, world_id) VALUES ('u1', 'x', 'nope')`),
        ).rejects.toThrow();
    });

    it('署名のある行は公開中の版 1 行になり、定義・lock・署名・version はそのまま', () => {
        const signed = OLD.filter((o) => o.signature !== null);
        expect(state.versions).toHaveLength(signed.length);
        for (const old of signed) {
            const id = newIdOf(old);
            const v = versionOf(id);
            expect(v).toMatchObject({
                version: old.version,
                definition: old.definition,
                lock: old.lock,
                signature: old.signature,
            });
            expect(ms(v?.published_at)).toBe(old.updated_at.getTime());
            expect(state.worlds.find((w) => w.id === id)?.current_version_id).toBe(v?.id);
        }
    });

    it('署名のない行には版を作らず、公開中は NULL', () => {
        for (const old of OLD.filter((o) => o.signature === null)) {
            expect(versionOf(newIdOf(old))).toBeUndefined();
            expect(state.worlds.find((w) => w.id === newIdOf(old))?.current_version_id).toBeNull();
        }
    });

    it('下書き: 公開中は draft_*、未公開は今の定義（あれば draft_*）を移す', () => {
        expect(draftOf(newIdOf(byWorldName('pub')))).toBeUndefined();
        expect(draftOf(newIdOf(byWorldName('legacy')))).toBeUndefined();
        expect(draftOf(newIdOf(byWorldName('drafted')))).toMatchObject({
            definition: def('drafted', '編集中', '1.1.0'),
            lock: LOCK,
        });
        expect(ms(draftOf(newIdOf(byWorldName('drafted')))?.updated_at)).toBe(T('3').getTime());
        expect(draftOf(newIdOf(byWorldName('unsigned')))).toMatchObject({
            definition: def('unsigned', '署名なし', '0.1.0'),
            lock: LOCK,
        });
        expect(ms(draftOf(newIdOf(byWorldName('unsigned')))?.updated_at)).toBe(T('4').getTime());
        expect(draftOf(newIdOf(byWorldName('odd')))).toMatchObject({ definition: def('odd', '新しい', '0.2.0') });
        expect(draftOf(newIdOf(byWorldName('collide')))).toMatchObject({ definition: def('collide', '重なる') });
    });

    it('content_hash は SQL では入れず、埋め戻しで shared の worldContentHash() と同じ値になる', async () => {
        expect(state.hashesBeforeBackfill.every((h) => h === null)).toBe(true);
        expect(state.backfilled).toBe(state.versions.length);
        for (const old of OLD.filter((o) => o.signature !== null)) {
            const expected = await worldContentHash({ definition: old.definition, lock: old.lock }, sha256Crypto);
            expect(versionOf(newIdOf(old))?.content_hash).toBe(expected);
            expect(expected).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
        }
        // 何度当ててもよい
        expect(await backfillWorldContentHashes(db())).toBe(0);
    });

    it('古い列は消さず、中身も変えない（デプロイ中の古い Pod・古いイメージに戻したときに読む）', () => {
        for (const old of OLD) {
            const row = state.worlds.find((w) => w.id === newIdOf(old));
            expect(row).toMatchObject({
                name: old.name,
                version: old.version,
                definition: old.definition,
                lock: old.lock,
                signature: old.signature,
                draft_definition: old.draft_definition,
                draft_lock: old.draft_lock,
            });
        }
    });

    it('既存のインスタンスは版を指さない（列だけ足す）', async () => {
        const [inst] = await db().execute<{ content_hash: string | null; world_version_id: string | null }>(
            sql`SELECT content_hash, world_version_id FROM instances WHERE id = 'inst-1'`,
        );
        expect(inst).toEqual({ content_hash: null, world_version_id: null });
    });

    it('別のワールドの版を公開中に指せない・同じ version は 1 つ・インスタンスが指す版は消せない', async () => {
        const pub = newIdOf(byWorldName('pub'));
        const drafted = newIdOf(byWorldName('drafted'));
        const otherVersion = versionOf(drafted)?.id ?? '';
        await expect(
            db().execute(sql`UPDATE worlds SET current_version_id = ${otherVersion} WHERE id = ${pub}`),
        ).rejects.toThrow();
        await expect(
            db().execute(sql`
                INSERT INTO world_versions (id, world_id, version, definition) VALUES ('dup', ${pub}, '1.0.0', '{}'::jsonb)
            `),
        ).rejects.toThrow();
        // 公開中でない版でも、インスタンスが指している間は消せない（RESTRICT）
        await db().execute(sql`
            INSERT INTO world_versions (id, world_id, version, definition) VALUES ('old', ${pub}, '0.9.0', '{}'::jsonb)
        `);
        await db().execute(sql`UPDATE instances SET world_version_id = 'old' WHERE id = 'inst-1'`);
        await expect(db().execute(sql`DELETE FROM world_versions WHERE id = 'old'`)).rejects.toThrow();
        await db().execute(sql`UPDATE instances SET world_version_id = NULL WHERE id = 'inst-1'`);
        await db().execute(sql`DELETE FROM world_versions WHERE id = 'old'`);
    });
});
