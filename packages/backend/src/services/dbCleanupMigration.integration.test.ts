import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signWorld, type WorldSigningKey } from '@ubichill/shared';
import bcrypt from 'bcryptjs';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { nodeWorldCrypto } from './worldCrypto';

vi.mock('./instanceRuntime', () => ({
    instanceRuntime: {
        provision: vi.fn(async () => ({ base: 'http://runtime.test', gen: 'g1', epoch: 1 })),
        presence: vi.fn(async () => new Map()),
        ticket: vi.fn(async (instanceId: string, userId: string) => ({ token: `ticket:${instanceId}:${userId}` })),
    },
}));

/**
 * DB の後片付け（0024: 古い列を書かない・古い鍵のテーブルを消す、0025: 古い列を消す）の前後で、ワールドとインスタンスの API が同じ結果になるか。
 * 前のマイグレーションまで当てた使い捨ての DB に、その時点のイメージが書く形のデータ（公開中・下書きあり・署名なしのワールド、
 * パスワードあり・なしのインスタンス、古い鍵のテーブルの行）を入れ、読み取りの応答を控えてから残りのマイグレーションを当てて比べる。
 * DATABASE_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL;
const MIGRATIONS = path.resolve(__dirname, '../../../db/drizzle');
const BASE = 'http://db-cleanup.test';
const HANDLE = 'cleanup_alice';
const AUTHOR_ID = 'cleanup-alice';
const PASSWORD = 'correct horse';

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

function newKey(): WorldSigningKey {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
        publicKey: publicKey.export({ format: 'jwk' }).x as string,
        sign: async (message) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url'),
    };
}

const def = (name: string, label: string, version = '1.0.0') => ({
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    metadata: { name, version },
    spec: { displayName: label, capacity: { default: 2, max: 4 }, initialEntities: [] },
});
const LOCK = { lockVersion: 1, mods: {} };
const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

type Modules = {
    db: typeof import('@ubichill/db');
    sql: typeof import('drizzle-orm').sql;
    worldRegistry: typeof import('./worldRegistry').worldRegistry;
    instanceManager: typeof import('./instanceManager').instanceManager;
    InstanceJoinRejected: typeof import('./instanceManager').InstanceJoinRejected;
};

/** `from` まで当てた DB にデータを入れ、残りを当てる。読み取りの応答は当てる前後で控える。 */
function defineCleanupSuite(from: string): void {
    describe.skipIf(!RUN)(`${from} の DB に残りのマイグレーションを当てても API が同じ（DB 統合）`, () => {
        const dbName = `ubichill_cleanup_${from.slice(0, 4)}_${Date.now().toString(36)}`;
        const upTo = RUN ? migrationsUpTo(from) : '';
        const adminUrl = process.env.DATABASE_URL ?? '';
        const worldsDir = mkdtempSync(path.join(tmpdir(), 'ubichill-worlds-'));
        const key = newKey();
        const author = () => `${HANDLE}@${new URL(BASE).host}`;
        const urlOf = (worldName: string) => `${BASE}/api/v1/authors/${HANDLE}/worlds/${worldName}.yaml`;
        const ids = {
            pub: 'cleanuppub00000000000',
            drafted: 'cleanupdrafted0000000',
            unsigned: 'cleanupunsigned000000',
        };
        const instanceIds = { open: 'inst-open', locked: 'inst-locked' } as const;
        const state: {
            admin?: ReturnType<typeof import('@ubichill/db').createDatabase>;
            m?: Modules;
            before?: unknown;
            after?: unknown;
            hadOldKeyTables?: boolean;
        } = {};
        const m = (): Modules => {
            if (!state.m) throw new Error('読み込んでいません');
            return state.m;
        };

        const signed = (definition: unknown, lock: unknown) =>
            signWorld({ definition, lock }, key, nodeWorldCrypto, { author: author() });

        const fileBody = async (worldName: string, kind: 'yaml' | 'lock.json' | 'sig.json') => {
            const file = await m().worldRegistry.worldFile(HANDLE, `${worldName}.${kind}`);
            if (!file || !('body' in file)) return undefined;
            return kind === 'yaml' ? (yaml.parse(file.body) as unknown) : (JSON.parse(file.body) as unknown);
        };

        /** 読み取りの API の応答（ワールドの取得・一覧・配信・エディタ、インスタンスの一覧・取得）。 */
        const observe = async () => {
            const { worldRegistry, instanceManager } = m();
            const worlds = await Promise.all(
                (['pub', 'drafted', 'unsigned'] as const).map(async (n) => ({
                    resolved: await worldRegistry.resolveLocal(ids[n]),
                    byUrl: await worldRegistry.resolveRefDetailed(urlOf(n)),
                    editor: await worldRegistry.getEditorDefinition(ids[n]),
                    yaml: await fileBody(n, 'yaml'),
                    lock: await fileBody(n, 'lock.json'),
                    sig: await fileBody(n, 'sig.json'),
                })),
            );
            return {
                worlds,
                list: await worldRegistry.listWorlds('local'),
                instances: await instanceManager.listInstances({ includeFull: true, viewerId: AUTHOR_ID }),
                instancesByWorld: await instanceManager.listInstances({ worldId: urlOf('pub'), viewerId: AUTHOR_ID }),
                instance: await instanceManager.getInstance(instanceIds.locked),
            };
        };

        /** その時点のイメージが書く形でデータを入れる（worlds の古い列は 0023 のイメージと同じく版・下書きから書き直した値）。 */
        const seed = async () => {
            const { db, sql } = m();
            const database = db.db;
            await database.execute(sql`
                INSERT INTO users (id, name, email, handle) VALUES (${AUTHOR_ID}, 'Alice', 'cleanup-alice@example.com', ${HANDLE})
            `);
            await db.authorKeyRepository.createLocal({
                userId: AUTHOR_ID,
                kind: 'browser',
                name: 'テスト',
                publicKey: key.publicKey,
            });
            const pubDef = def('pub', '公開中');
            const pubSig = await signed(pubDef, LOCK);
            const draftedDef = def('drafted', '公開中');
            const draftedSig = await signed(draftedDef, null);
            const draftedDraft = def('drafted', '編集中', '1.1.0');
            const unsignedDef = def('unsigned', '署名なし', '0.1.0');
            const worldRow = async (
                id: string,
                worldName: string,
                legacy: { version: string; definition: unknown; lock: unknown; signature: unknown },
                draft?: { definition: unknown; lock: unknown },
                writeLegacy = true,
            ) => {
                // 0024 のイメージが作った行は古い列が NULL
                await database.execute(sql`
                    INSERT INTO worlds (id, author_id, world_name, name, version, definition, lock, signature,
                                        draft_definition, draft_lock, draft_updated_at)
                    VALUES (${id}, ${AUTHOR_ID}, ${worldName}, ${writeLegacy ? id : null},
                            ${writeLegacy ? legacy.version : null}, ${writeLegacy ? json(legacy.definition) : null}::jsonb,
                            ${json(legacy.lock)}::jsonb, ${json(legacy.signature)}::jsonb,
                            ${legacy.signature && draft ? json(draft.definition) : null}::jsonb,
                            ${legacy.signature && draft ? json(draft.lock) : null}::jsonb,
                            ${legacy.signature && draft ? new Date().toISOString() : null}::timestamptz)
                `);
                if (legacy.signature) {
                    await database.execute(sql`
                        INSERT INTO world_versions (id, world_id, version, definition, lock, signature)
                        VALUES (${`v-${worldName}`}, ${id}, ${legacy.version}, ${json(legacy.definition)}::jsonb,
                                ${json(legacy.lock)}::jsonb, ${json(legacy.signature)}::jsonb)
                    `);
                    await database.execute(
                        sql`UPDATE worlds SET current_version_id = ${`v-${worldName}`} WHERE id = ${id}`,
                    );
                }
                if (draft) {
                    await database.execute(sql`
                        INSERT INTO world_drafts (world_id, definition, lock)
                        VALUES (${id}, ${json(draft.definition)}::jsonb, ${json(draft.lock)}::jsonb)
                    `);
                }
            };
            await worldRow(ids.pub, 'pub', { version: '1.0.0', definition: pubDef, lock: LOCK, signature: pubSig });
            await worldRow(
                ids.drafted,
                'drafted',
                { version: '1.0.0', definition: draftedDef, lock: null, signature: draftedSig },
                { definition: draftedDraft, lock: null },
            );
            await worldRow(
                ids.unsigned,
                'unsigned',
                { version: '0.1.0', definition: unsignedDef, lock: LOCK, signature: null },
                { definition: unsignedDef, lock: LOCK },
                from === '0023_world_versions',
            );
            // 本番と同じく、版の content_hash は migrate.js の埋め戻しで入れる
            await db.backfillWorldContentHashes(database);

            const passwordHash = await bcrypt.hash(PASSWORD, 4);
            // current_users は Go の在籍と食い違う値（今のコードは読まない）
            await database.execute(sql`
                INSERT INTO instances (id, world_ref, leader_id, access_type, has_password, password_hash, current_users,
                                       world_version_id, max_users)
                VALUES (${instanceIds.open}, ${urlOf('pub')}, ${AUTHOR_ID}, 'public', false, NULL, 3, 'v-pub', 4),
                       (${instanceIds.locked}, ${urlOf('pub')}, ${AUTHOR_ID}, 'public', true, ${passwordHash}, 0, NULL, 4)
            `);

            const [tables] = await database.execute<{ pe: string | null }>(
                sql`SELECT to_regclass('publishing_environments')::text AS pe`,
            );
            state.hadOldKeyTables = !!tables?.pe;
            if (state.hadOldKeyTables) {
                await database.execute(sql`
                    INSERT INTO publishing_environments (id, user_id, kind, name, public_key)
                    VALUES ('pe-old', ${AUTHOR_ID}, 'browser', '古い', ${key.publicKey})
                `);
                await database.execute(sql`
                    INSERT INTO author_bindings (account, keys, display_name)
                    VALUES ('bob@remote.example', ${JSON.stringify([{ publicKey: newKey().publicKey }])}::jsonb, 'Bob')
                `);
            }
        };

        beforeAll(async () => {
            const url = new URL(adminUrl);
            url.pathname = `/${dbName}`;
            // @ubichill/db は読み込んだ時点の DATABASE_URL に繋ぐので、書き換えてから読み込み直す
            process.env.DATABASE_URL = url.toString();
            process.env.PUBLIC_BASE_URL = BASE;
            process.env.WORLDS_DIR = worldsDir;
            process.env.NODE_ENV ??= 'test';
            process.env.BETTER_AUTH_SECRET ??= 'test-secret';
            process.env.INSTANCE_ADMIN_TOKEN ??= 'test-instance-token-at-least-32-characters';
            vi.resetModules();
            const db = await import('@ubichill/db');
            state.admin = db.createDatabase(adminUrl);
            await state.admin.client.unsafe(`CREATE DATABASE "${dbName}"`);
            await state.admin.client.unsafe(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC'`);
            await migrate(db.db, { migrationsFolder: upTo });
            const registry = await import('./worldRegistry');
            const manager = await import('./instanceManager');
            state.m = {
                db,
                sql: (await import('drizzle-orm')).sql,
                worldRegistry: registry.worldRegistry,
                instanceManager: manager.instanceManager,
                InstanceJoinRejected: manager.InstanceJoinRejected,
            };
            await seed();
            await registry.worldRegistry.initialize();
            state.before = await observe();

            await migrate(db.db, { migrationsFolder: MIGRATIONS });
            await db.backfillWorldContentHashes(db.db);
            registry.worldRegistry.invalidateResolvedWorlds();
            state.after = await observe();
        }, 60_000);

        afterAll(async () => {
            await state.m?.db.client.end({ timeout: 5 });
            await state.admin?.client.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
            await state.admin?.client.end({ timeout: 5 });
            process.env.DATABASE_URL = adminUrl;
            for (const dir of [upTo, worldsDir]) if (dir) rmSync(dir, { recursive: true, force: true });
        });

        it('読み取りの応答（ワールドの取得・一覧・配信・エディタ、インスタンスの一覧・取得）が当てる前と同じ', () => {
            expect(state.after).toEqual(state.before);
        });

        it('当てる前の応答が期待どおり（比べる元が空振りしていない）', () => {
            const before = state.before as Awaited<ReturnType<typeof observe>>;
            expect(before.worlds[0]).toMatchObject({
                resolved: { ok: true, world: { id: ids.pub, identity: { status: 'verified', author: author() } } },
                sig: expect.objectContaining({ kind: 'world' }),
            });
            expect(before.worlds[1]?.editor).toMatchObject({
                definition: { spec: { displayName: '編集中' } },
                hasDraft: true,
                published: true,
            });
            expect(before.worlds[2]).toMatchObject({
                resolved: { ok: true, world: { identity: { status: 'unsigned' } } },
                editor: { hasDraft: false, published: false },
            });
            expect(before.list.map((w) => w.id).sort()).toEqual([ids.drafted, ids.pub].sort());
            const access = Object.fromEntries(before.instances.map((i) => [i.id, i.access.password]));
            expect(access).toEqual({ [instanceIds.open]: false, [instanceIds.locked]: true });
            expect(before.instances.every((i) => i.stats.currentUsers === 0)).toBe(true);
            expect(before.instancesByWorld).toHaveLength(2);
            expect(before.instance?.access.password).toBe(true);
        });

        it('入室: パスワードなしは入れ、パスワード付きは正しいパスワードのときだけ入れる', async () => {
            const { instanceManager, InstanceJoinRejected } = m();
            const alice = { id: AUTHOR_ID, name: 'Alice' };
            await expect(instanceManager.join(instanceIds.open, alice)).resolves.toEqual({
                token: `ticket:${instanceIds.open}:${AUTHOR_ID}`,
            });
            await expect(instanceManager.join(instanceIds.locked, alice)).rejects.toThrow(InstanceJoinRejected);
            await expect(instanceManager.join(instanceIds.locked, alice, 'wrong')).rejects.toThrow(
                InstanceJoinRejected,
            );
            await expect(instanceManager.join(instanceIds.locked, alice, PASSWORD)).resolves.toEqual({
                token: `ticket:${instanceIds.locked}:${AUTHOR_ID}`,
            });
        });

        it('作成: パスワードの有無が一覧の hasPassword（access.password）と入室に出る', async () => {
            const { instanceManager, InstanceJoinRejected } = m();
            const locked = await instanceManager.createInstance(
                { worldId: urlOf('pub'), access: { type: 'public', tags: [], password: PASSWORD } },
                AUTHOR_ID,
            );
            const open = await instanceManager.createInstance({ worldId: urlOf('pub') }, AUTHOR_ID);
            if ('error' in locked || 'error' in open) throw new Error('作成に失敗しました');
            expect(locked.access.password).toBe(true);
            expect(open.access.password).toBe(false);
            const listed = await instanceManager.listInstances({ includeFull: true, viewerId: AUTHOR_ID });
            expect(listed.find((i) => i.id === locked.id)?.access.password).toBe(true);
            expect(listed.find((i) => i.id === open.id)?.access.password).toBe(false);
            const alice = { id: AUTHOR_ID, name: 'Alice' };
            await expect(instanceManager.join(locked.id, alice)).rejects.toThrow(InstanceJoinRejected);
            await expect(instanceManager.join(locked.id, alice, PASSWORD)).resolves.toBeDefined();
            await expect(instanceManager.join(open.id, alice)).resolves.toBeDefined();
        });

        it('保存: 下書き・公開・新規作成が通り、結果が読める', async () => {
            const { worldRegistry, db } = m();
            const unsignedDraft = def('unsigned', '書き直し', '0.2.0');
            expect(
                await worldRegistry.saveBundle(
                    AUTHOR_ID,
                    { definition: unsignedDraft, lock: null },
                    { editingId: ids.unsigned },
                ),
            ).toMatchObject({ ok: true, world: { id: ids.unsigned } });
            expect(await worldRegistry.getEditorDefinition(ids.unsigned)).toMatchObject({
                definition: { spec: { displayName: '書き直し' } },
                published: false,
            });

            const draft = def('drafted', '編集中', '1.1.0');
            const signature = await signed(draft, null);
            expect(
                await worldRegistry.saveBundle(
                    AUTHOR_ID,
                    { definition: draft, lock: null, signature },
                    { editingId: ids.drafted },
                ),
            ).toMatchObject({ ok: true, saved: 'published', world: { version: '1.1.0', displayName: '編集中' } });
            expect(await worldRegistry.getEditorDefinition(ids.drafted)).toMatchObject({ hasDraft: false });
            expect(await fileBody('drafted', 'sig.json')).toEqual(signature);
            expect(await db.worldRepository.listVersions(ids.drafted)).toHaveLength(2);

            const created = await worldRegistry.saveBundle(AUTHOR_ID, { definition: def('fresh', '新規'), lock: null });
            if (!created.ok) throw new Error(created.message);
            expect(created.world.id).toMatch(/^[a-z0-9]{21}$/);
            expect(await worldRegistry.resolveLocal(created.world.id)).toMatchObject({
                ok: true,
                world: { displayName: '新規', identity: { status: 'unsigned' } },
            });
        });

        it('古い鍵のテーブル（publishing_environments・author_bindings）は消え、作者の確認は author_keys だけで変わらない', async () => {
            const { db, sql } = m();
            const [tables] = await db.db.execute<{ pe: string | null; ab: string | null }>(
                sql`SELECT to_regclass('publishing_environments')::text AS pe, to_regclass('author_bindings')::text AS ab`,
            );
            expect(tables).toEqual({ pe: null, ab: null });
            expect(await db.authorKeyRepository.listByUser(AUTHOR_ID)).toHaveLength(1);
        });

        it('0025: 古い列・トリガーは消え、content_hash は NOT NULL', async () => {
            const { db, sql } = m();
            const columns = await db.db.execute<{ table_name: string; column_name: string }>(sql`
                SELECT table_name, column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND (
                    (table_name = 'worlds' AND column_name IN ('name', 'version', 'definition', 'lock', 'signature',
                                                              'draft_definition', 'draft_lock', 'draft_updated_at'))
                    OR (table_name = 'instances' AND column_name IN ('has_password', 'current_users')))
            `);
            expect([...columns]).toEqual([]);
            const [trigger] = await db.db.execute<{ n: number }>(
                sql`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'instances_sync_has_password'`,
            );
            expect(trigger?.n).toBe(0);
            await expect(
                db.db.execute(sql`
                    INSERT INTO world_versions (id, world_id, version, definition) VALUES ('nohash', ${ids.pub}, '9.9.9', '{}'::jsonb)
                `),
            ).rejects.toThrow();
        });
    });
}

defineCleanupSuite('0023_world_versions');
defineCleanupSuite('0024_db_cleanup_stop_using');

describe.skipIf(!RUN)('0025 は content_hash が空の版があれば止まる（DB 統合）', () => {
    it('何も変えずに失敗し、古い列は残る', async () => {
        const adminUrl = process.env.DATABASE_URL ?? '';
        const dbName = `ubichill_cleanup_stop_${Date.now().toString(36)}`;
        const upTo0024 = migrationsUpTo('0024_db_cleanup_stop_using');
        const { createDatabase } = await import('@ubichill/db');
        const { sql } = await import('drizzle-orm');
        const admin = createDatabase(adminUrl);
        await admin.client.unsafe(`CREATE DATABASE "${dbName}"`);
        await admin.client.unsafe(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC'`);
        const url = new URL(adminUrl);
        url.pathname = `/${dbName}`;
        const scratch = createDatabase(url.toString());
        try {
            await migrate(scratch.db, { migrationsFolder: upTo0024 });
            await scratch.db.execute(sql`
                INSERT INTO users (id, name, email, handle) VALUES ('u1', 'U', 'u1@example.com', 'u_one')
            `);
            await scratch.db.execute(sql`
                INSERT INTO worlds (id, author_id, world_name) VALUES ('w1', 'u1', 'w')
            `);
            await scratch.db.execute(sql`
                INSERT INTO world_versions (id, world_id, version, definition) VALUES ('v1', 'w1', '1.0.0', '{}'::jsonb)
            `);
            await expect(migrate(scratch.db, { migrationsFolder: MIGRATIONS })).rejects.toThrow();
            const [left] = await scratch.db.execute<{ n: number }>(sql`
                SELECT count(*)::int AS n FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'instances' AND column_name = 'has_password'
            `);
            expect(left?.n).toBe(1);
        } finally {
            await scratch.client.end({ timeout: 5 });
            await admin.client.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
            await admin.client.end({ timeout: 5 });
            rmSync(upTo0024, { recursive: true, force: true });
        }
    });
});
