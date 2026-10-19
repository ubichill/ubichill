import { generateKeyPairSync, sign } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signWorld, type WorldSigningKey } from '@ubichill/shared';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { nodeWorldCrypto } from './worldCrypto';

vi.mock('./instanceRuntime', () => ({
    instanceRuntime: { provision: vi.fn(async () => {}), presence: vi.fn(async () => new Map()) },
}));

/**
 * 0023_world_versions の前後で、ワールドの API（取得・一覧・YAML の配信・エディタ・署名し直し・公開）が同じ結果になるか。
 * 0022 まで当てた使い捨ての DB に、本番と同じ形の worlds（公開中・下書きあり・未公開・作者なしの署名・内容と合わない署名）を
 * 入れてから 0023 と content_hash の埋め戻しを当て、本物の worldRegistry で読む。期待値は 0022 の 1 行の意味
 * （公開中は definition/lock/signature を配る、エディタは draft ?? definition、id は name）から作る。
 * DATABASE_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL;
const MIGRATIONS = path.resolve(__dirname, '../../../db/drizzle');
const BASE = 'http://worlds-migration.test';
const HANDLE = 'mig_alice';
const AUTHOR_ID = 'mig-alice';

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

interface OldRow {
    name: string;
    worldName: string;
    version: string;
    definition: unknown;
    lock: unknown;
    signature: unknown;
    draftDefinition: unknown;
    draftLock: unknown;
}

describe.skipIf(!RUN)('0023 の前後でワールドの API が同じ（DB 統合）', () => {
    const dbName = `ubichill_world_api_${Date.now().toString(36)}`;
    const upTo0022 = RUN ? migrationsUpTo('0022_users_drop_columns') : '';
    const adminUrl = process.env.DATABASE_URL ?? '';
    const state: { admin?: ReturnType<typeof import('@ubichill/db').createDatabase> } = {};
    const worldsDir = mkdtempSync(path.join(tmpdir(), 'ubichill-worlds-'));
    const key = newKey();
    const rows: Record<'pub' | 'drafted' | 'unsigned' | 'keyonly' | 'broken', OldRow> = {} as never;
    let worldRegistry: typeof import('./worldRegistry').worldRegistry;
    let dbModule: typeof import('@ubichill/db');
    const author = () => `${HANDLE}@${new URL(BASE).host}`;
    const urlOf = (worldName: string) => `${BASE}/api/v1/authors/${HANDLE}/worlds/${worldName}.yaml`;

    beforeAll(async () => {
        const url = new URL(adminUrl);
        url.pathname = `/${dbName}`;
        // @ubichill/db は読み込んだ時点の DATABASE_URL に繋ぐ（最初の問い合わせまで接続しない）ので、先に書き換えてから読み込む
        process.env.DATABASE_URL = url.toString();
        process.env.PUBLIC_BASE_URL = BASE;
        process.env.WORLDS_DIR = worldsDir;
        process.env.NODE_ENV ??= 'test';
        process.env.BETTER_AUTH_SECRET ??= 'test-secret';
        process.env.INSTANCE_ADMIN_TOKEN ??= 'test-instance-token-at-least-32-characters';
        dbModule = await import('@ubichill/db');
        state.admin = dbModule.createDatabase(adminUrl);
        await state.admin.client.unsafe(`CREATE DATABASE "${dbName}"`);
        await state.admin.client.unsafe(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC'`);
        const { db, backfillWorldContentHashes } = dbModule;
        const { sql } = await import('drizzle-orm');
        await migrate(db, { migrationsFolder: upTo0022 });

        const signed = async (definition: unknown, lock: unknown, signingKey = key, signedOver?: unknown) =>
            signWorld({ definition: signedOver ?? definition, lock }, signingKey, nodeWorldCrypto, {
                author: author(),
            });
        rows.pub = {
            name: 'pubid0000000000000000',
            worldName: 'pub',
            version: '1.0.0',
            definition: def('pub', '公開中'),
            lock: LOCK,
            signature: await signed(def('pub', '公開中'), LOCK),
            draftDefinition: null,
            draftLock: null,
        };
        rows.drafted = {
            name: 'draftedid000000000000',
            worldName: 'drafted',
            version: '1.0.0',
            definition: def('drafted', '公開中'),
            lock: null,
            signature: await signed(def('drafted', '公開中'), null),
            draftDefinition: def('drafted', '編集中', '1.1.0'),
            draftLock: null,
        };
        rows.unsigned = {
            name: 'unsignedid00000000000',
            worldName: 'unsigned',
            version: '0.1.0',
            definition: def('unsigned', '署名なし', '0.1.0'),
            lock: null,
            signature: null,
            draftDefinition: null,
            draftLock: null,
        };
        rows.keyonly = {
            name: 'keyonlyid00000000000',
            worldName: 'keyonly',
            version: '1.0.0',
            definition: def('keyonly', '鍵だけ'),
            lock: null,
            // 登録していない鍵の署名（作者は付かない。一覧に出ない）
            signature: await signed(def('keyonly', '鍵だけ'), null, newKey()),
            draftDefinition: null,
            draftLock: null,
        };
        rows.broken = {
            name: 'brokenid0000000000000',
            worldName: 'broken',
            version: '1.0.0',
            definition: def('broken', '改竄後'),
            lock: null,
            signature: await signed(def('broken', '改竄後'), null, key, def('broken', '改竄前')),
            draftDefinition: null,
            draftLock: null,
        };

        await db.execute(sql`
            INSERT INTO users (id, name, email, handle) VALUES (${AUTHOR_ID}, 'Alice', 'mig-alice@example.com', ${HANDLE})
        `);
        await dbModule.authorKeyRepository.createLocal({
            userId: AUTHOR_ID,
            kind: 'browser',
            name: 'テスト',
            publicKey: key.publicKey,
        });
        const json = (v: unknown) => (v === null ? null : JSON.stringify(v));
        for (const r of Object.values(rows)) {
            await db.execute(sql`
                INSERT INTO worlds (id, author_id, name, world_name, version, definition, lock, signature,
                                    draft_definition, draft_lock, draft_updated_at)
                VALUES (${`old-${r.worldName}`}, ${AUTHOR_ID}, ${r.name}, ${r.worldName}, ${r.version},
                        ${json(r.definition)}::jsonb, ${json(r.lock)}::jsonb, ${json(r.signature)}::jsonb,
                        ${json(r.draftDefinition)}::jsonb, ${json(r.draftLock)}::jsonb,
                        ${r.draftDefinition ? new Date().toISOString() : null}::timestamptz)
            `);
        }
        await db.execute(sql`
            INSERT INTO world_name_aliases (author_id, name, world_id) VALUES (${AUTHOR_ID}, 'pub-before', 'old-pub')
        `);

        await migrate(db, { migrationsFolder: MIGRATIONS });
        await backfillWorldContentHashes(db);
        ({ worldRegistry } = await import('./worldRegistry'));
        await worldRegistry.initialize();
    }, 60_000);

    afterAll(async () => {
        await dbModule?.client.end({ timeout: 5 });
        await state.admin?.client.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
        await state.admin?.client.end({ timeout: 5 });
        for (const dir of [upTo0022, worldsDir]) if (dir) rmSync(dir, { recursive: true, force: true });
    });

    const fileBody = async (worldName: string, kind: 'yaml' | 'lock.json' | 'sig.json') => {
        const file = await worldRegistry.worldFile(HANDLE, `${worldName}.${kind}`);
        if (!file || !('body' in file)) return undefined;
        return kind === 'yaml' ? (yaml.parse(file.body) as unknown) : (JSON.parse(file.body) as unknown);
    };

    it('取得: id は以前の name のまま、公開中の版を作者付きで返す', async () => {
        expect(await worldRegistry.resolveLocal(rows.pub.name)).toMatchObject({
            ok: true,
            world: {
                id: rows.pub.name,
                url: urlOf('pub'),
                version: '1.0.0',
                displayName: '公開中',
                identity: { status: 'verified', author: author() },
            },
        });
        // 公開中の下書きは配らない
        expect(await worldRegistry.resolveLocal(rows.drafted.name)).toMatchObject({
            ok: true,
            world: { id: rows.drafted.name, version: '1.0.0', displayName: '公開中' },
        });
        expect(await worldRegistry.resolveLocal(rows.unsigned.name)).toMatchObject({
            ok: true,
            world: { id: rows.unsigned.name, version: '0.1.0', identity: { status: 'unsigned' } },
        });
        const keyonly = await worldRegistry.resolveLocal(rows.keyonly.name);
        expect(keyonly).toMatchObject({ ok: true, world: { identity: { status: 'verified' } } });
        expect(keyonly.ok && keyonly.world.identity).not.toHaveProperty('author');
        expect(await worldRegistry.resolveLocal(rows.broken.name)).toMatchObject({
            ok: false,
            reason: 'integrity',
            signatureReason: 'content-mismatch',
        });
        // 以前の名前・以前の形の URL（/api/v1/worlds/<name>）・共有の参照からもたどれる
        expect(await worldRegistry.resolveRefDetailed(urlOf('pub-before'))).toMatchObject({
            ok: true,
            world: { id: rows.pub.name },
        });
        expect(await worldRegistry.resolveRefDetailed(`${BASE}/api/v1/worlds/${rows.pub.name}`)).toMatchObject({
            ok: true,
            world: { id: rows.pub.name },
        });
        expect(await worldRegistry.resolveRefDetailed(`@${HANDLE}/drafted`)).toMatchObject({
            ok: true,
            world: { id: rows.drafted.name },
        });
    });

    it('一覧: 作者まで確かめられたものだけ（公開中・下書きありの 2 つ）', async () => {
        const ids = (await worldRegistry.listWorlds('local')).map((w) => w.id).sort();
        expect(ids).toEqual([rows.drafted.name, rows.pub.name].sort());
    });

    it('YAML の配信: 0022 の行の definition・lock・signature をそのまま配る（下書きは配らない）', async () => {
        for (const r of [rows.pub, rows.drafted, rows.unsigned, rows.keyonly, rows.broken]) {
            expect(await fileBody(r.worldName, 'yaml')).toEqual(r.definition);
            expect(await fileBody(r.worldName, 'lock.json')).toEqual(r.lock ?? undefined);
            expect(await fileBody(r.worldName, 'sig.json')).toEqual(r.signature ?? undefined);
        }
    });

    it('エディタ: 下書きがあれば下書き。hasDraft は公開中のワールドの下書きだけ', async () => {
        expect(await worldRegistry.getEditorDefinition(rows.drafted.name)).toMatchObject({
            definition: { spec: { displayName: '編集中' } },
            hasDraft: true,
            published: true,
        });
        expect(await worldRegistry.getEditorDefinition(rows.pub.name)).toMatchObject({
            definition: { spec: { displayName: '公開中' } },
            hasDraft: false,
            published: true,
        });
        expect(await worldRegistry.getEditorDefinition(rows.unsigned.name)).toMatchObject({
            definition: { spec: { displayName: '署名なし' } },
            hasDraft: false,
            published: false,
        });
    });

    it('署名し直し: 公開中の版と同じ中身なら公開のまま、下書きも残る', async () => {
        const signature = await signWorld({ definition: rows.drafted.definition, lock: null }, key, nodeWorldCrypto, {
            author: author(),
        });
        expect(
            await worldRegistry.saveBundle(
                AUTHOR_ID,
                { definition: rows.drafted.definition, lock: null, signature },
                { editingId: rows.drafted.name },
            ),
        ).toMatchObject({ ok: true, saved: 'published', world: { id: rows.drafted.name } });
        expect(await fileBody('drafted', 'sig.json')).toEqual(signature);
        expect(await worldRegistry.getEditorDefinition(rows.drafted.name)).toMatchObject({ hasDraft: true });
    });

    it('公開: 下書きを署名して公開すると版が増え、下書きは消える', async () => {
        const draft = rows.drafted.draftDefinition;
        const signature = await signWorld({ definition: draft, lock: null }, key, nodeWorldCrypto, {
            author: author(),
        });
        expect(
            await worldRegistry.saveBundle(
                AUTHOR_ID,
                { definition: draft, lock: null, signature },
                { editingId: rows.drafted.name },
            ),
        ).toMatchObject({ ok: true, saved: 'published', world: { version: '1.1.0', displayName: '編集中' } });
        expect(await worldRegistry.getEditorDefinition(rows.drafted.name)).toMatchObject({ hasDraft: false });
        expect(await dbModule.worldRepository.listVersions(rows.drafted.name)).toHaveLength(2);
    });

    it('新しく作るワールドの id も、以前の name と同じ形（小文字と数字の 21 文字）', async () => {
        // 作れるのは 5 つまでなので 1 つ消す
        expect(await worldRegistry.deleteWorld(rows.broken.name)).toBe(true);
        const created = await worldRegistry.saveBundle(AUTHOR_ID, { definition: def('fresh', '新規'), lock: null });
        if (!created.ok) throw new Error(created.message);
        expect(created.world.id).toMatch(/^[a-z0-9]{21}$/);
    });
});
