import { generateKeyPairSync } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAuthorKeyRepository, createDatabase, type Database } from '@ubichill/db';
import {
    type AuthorKeyCheck,
    type AuthorKeyCheckResult,
    type AuthorKeyDirectoryDeps,
    type AuthorProfile,
    createAuthorKeyDirectory,
    type StoredAuthorBinding,
} from '@ubichill/shared';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorKeySources, withNormalizedKey } from './authorKeySources';
import { type PublishingEnvironmentRow, signingKeyListOf } from './publishingEnvironments';

/**
 * 0020_author_keys の結合テスト。DATABASE_URL の Postgres に使い捨ての DB を作り、0019 まで当てた DB に
 * 自サーバー・他サーバー・取り消し済み・handle なしの鍵を入れてから 0020 を当て、作者の確認と鍵一覧の文書が
 * 移行の前後で同じになることを確かめる（意図して変えたところは個別に確かめる）。DATABASE_URL がある時だけ走る。
 */
const RUN = !!process.env.DATABASE_URL;
const MIGRATIONS = path.resolve(__dirname, '../../../db/drizzle');
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const DOMAIN = 'self.example';
const NOW = Date.parse('2026-10-16T00:00:00.000Z');
const FETCHED = new Date(NOW - 10 * 60 * 1000);

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const newKey = (): string => generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x ?? '';
/** 同じ鍵の別の書き方（32 byte に入らない余りの bit を立てる）。 */
const extraBitsOf = (key: string): string => `${key.slice(0, 42)}${BASE64URL[BASE64URL.indexOf(key[42]) + 1]}`;
const standardOf = (key: string): string => Buffer.from(key, 'base64url').toString('base64');

/** 0019 までの journal だけを持つマイグレーションのフォルダを作る。 */
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

async function createScratchDatabase(name: string): Promise<{ db: Database; drop: () => Promise<void> }> {
    const admin = createDatabase(process.env.DATABASE_URL ?? '');
    await admin.client.unsafe(`CREATE DATABASE "${name}"`);
    // マイグレーションは 0018 で TimeZone が UTC であることを求める（接続する前に設定する）
    await admin.client.unsafe(`ALTER DATABASE "${name}" SET timezone TO 'UTC'`);
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.pathname = `/${name}`;
    const scratch = createDatabase(url.toString());
    return {
        db: scratch.db,
        drop: async () => {
            await scratch.client.end({ timeout: 5 });
            await admin.client.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
            await admin.client.end({ timeout: 5 });
        },
    };
}

/** 移行前のテーブル（publishing_environments・author_bindings）を読む、移行前と同じ形の取り出し。 */
function legacySources(db: Database): Pick<AuthorKeyDirectoryDeps, 'bindings'> & {
    findLocalAccount: (handle: string) => Promise<AuthorProfile | undefined>;
    listByHandle: (handle: string) => Promise<PublishingEnvironmentRow[] | undefined>;
} {
    const listByHandle = async (handle: string) => {
        const users = await db.execute<{ id: string }>(sql`SELECT id FROM users WHERE handle = ${handle}`);
        if (!users[0]) return undefined;
        const rows = await db.execute<{
            id: string;
            user_id: string;
            kind: string;
            name: string;
            public_key: string;
            created_at: Date;
            last_used_at: Date | null;
            revoked_at: Date | null;
        }>(sql`SELECT * FROM publishing_environments WHERE user_id = ${users[0].id} ORDER BY created_at, id`);
        return rows.map((r) => ({
            id: r.id,
            userId: r.user_id,
            kind: r.kind,
            name: r.name,
            publicKey: r.public_key,
            createdAt: new Date(r.created_at),
            lastUsedAt: r.last_used_at,
            revokedAt: r.revoked_at ? new Date(r.revoked_at) : null,
        }));
    };
    return {
        listByHandle,
        findLocalAccount: async (handle) => {
            const user = await db.execute<{ name: string }>(sql`SELECT name FROM users WHERE handle = ${handle}`);
            const rows = await listByHandle(handle);
            if (!user[0] || !rows) return undefined;
            return { keys: signingKeyListOf('x@x', rows, new Date(NOW)).keys, displayName: user[0].name };
        },
        bindings: {
            find: async (account): Promise<StoredAuthorBinding | undefined> => {
                const rows = await db.execute<{
                    keys: AuthorProfile['keys'];
                    display_name: string | null;
                    fetched_at: Date;
                }>(sql`SELECT keys, display_name, fetched_at FROM author_bindings WHERE account = ${account}`);
                const row = rows[0];
                return row
                    ? {
                          keys: row.keys,
                          displayName: row.display_name ?? undefined,
                          fetchedAt: new Date(row.fetched_at),
                      }
                    : undefined;
            },
            save: async () => undefined,
        },
    };
}

const directoryOf = (
    findAccount: (handle: string) => Promise<AuthorProfile | undefined>,
    bindings: AuthorKeyDirectoryDeps['bindings'],
) =>
    createAuthorKeyDirectory({
        local: { domain: () => DOMAIN, findAccount },
        bindings,
        confirmedContents: { record: async () => undefined, has: async () => false },
        // ネットワークには出ない（知らない鍵の取り直しは失敗し、保存した結果で答える）
        fetchJson: async () => undefined,
        allowHttp: false,
        now: () => NOW,
    });

async function checkAll(
    check: AuthorKeyCheck,
    authors: readonly string[],
    keys: readonly string[],
): Promise<Record<string, AuthorKeyCheckResult>> {
    const entries = await Promise.all(
        authors.flatMap((author) =>
            keys.map(async (key) => [`${author} ${key}`, await check(author, key, 'sha256-x')] as const),
        ),
    );
    return Object.fromEntries(entries);
}

describe.skipIf(!RUN)('0020_author_keys の移行 (DB統合)', () => {
    const scratchName = `ubichill_ak_mig_${stamp}`;
    const scratch: { db?: Database; drop?: () => Promise<void> } = {};
    const folders: string[] = [];

    const alice = { id: 'u_alice', handle: 'alice' };
    const bob = { id: 'u_bob' }; // handle が未設定（鍵は登録できる）
    const carol = { id: 'u_carol', handle: 'carol' };
    const keys = {
        a1: newKey(),
        a2: newKey(),
        a3: newKey(),
        a4: newKey(),
        b1: newKey(),
        c1: newKey(),
        r1: newKey(),
        r2: newKey(),
        r3: newKey(),
        r4: newKey(),
    };
    const at = (iso: string) => new Date(iso);
    const authors = [
        `alice@${DOMAIN}`,
        `bob@${DOMAIN}`,
        `carol@${DOMAIN}`,
        `nobody@${DOMAIN}`,
        'remote1@remote.example',
        'empty@remote.example',
        'mallory@evil.example',
        'broken@remote.example',
    ];
    const allKeys = [...Object.values(keys), extraBitsOf(keys.c1), extraBitsOf(keys.r3)];

    const before: {
        checks?: Record<string, AuthorKeyCheckResult>;
        aliceList?: unknown;
        carolList?: unknown;
    } = {};

    beforeAll(async () => {
        const created = await createScratchDatabase(scratchName);
        scratch.db = created.db;
        scratch.drop = created.drop;
        const db = created.db;
        const upTo19 = migrationsUpTo('0019_pending_registrations');
        folders.push(upTo19);
        await migrate(db, { migrationsFolder: upTo19 });

        await db.execute(sql`
            INSERT INTO users (id, name, email, email_verified, handle) VALUES
                (${alice.id}, 'アリス', 'alice@example.com', true, ${alice.handle}),
                (${bob.id}, 'ボブ', 'bob@example.com', true, NULL),
                (${carol.id}, 'キャロル', 'carol@example.com', true, ${carol.handle})
        `);
        await db.execute(sql`
            INSERT INTO publishing_environments
                (id, user_id, kind, name, public_key, api_token_hash, created_at, last_used_at, revoked_at, revoke_reason)
            VALUES
                ('pe_a1', ${alice.id}, 'browser', 'Chrome on Mac', ${keys.a1}, NULL, '2026-09-01T00:00:00Z', NULL, NULL, NULL),
                ('pe_a2', ${alice.id}, 'cli', 'laptop', ${keys.a2}, 'token_a2', '2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z', '2026-09-04T00:00:00Z', 'lost'),
                ('pe_a3', ${alice.id}, 'ci', 'GitHub Actions', ${keys.a3}, 'token_a3', '2026-09-05T00:00:00Z', NULL, '2026-09-06T00:00:00Z', 'compromised'),
                ('pe_a4', ${alice.id}, 'legacy', '以前の鍵', ${keys.a4}, NULL, '2026-08-01T00:00:00Z', NULL, NULL, NULL),
                ('pe_b1', ${bob.id}, 'browser', 'Firefox', ${keys.b1}, NULL, '2026-09-07T00:00:00Z', NULL, NULL, NULL),
                ('pe_c1', ${carol.id}, 'browser', 'Safari', ${extraBitsOf(keys.c1)}, NULL, '2026-09-08T00:00:00Z', NULL, NULL, NULL)
        `);
        const bindings = [
            {
                account: 'remote1@remote.example',
                displayName: 'リモート',
                keys: [
                    { publicKey: keys.r1, addedAt: '2026-07-01T00:00:00.000Z' },
                    { publicKey: keys.r2, addedAt: '2026-07-02T00:00:00.000Z', revokedAt: '2026-07-03T00:00:00.000Z' },
                    { publicKey: extraBitsOf(keys.r3) },
                    { publicKey: keys.r3, revokedAt: '2026-07-04T00:00:00.000Z' },
                ],
            },
            { account: 'empty@remote.example', displayName: null, keys: [] },
            // 他サーバーがこのサーバーのアリスの鍵を名乗っている
            { account: 'mallory@evil.example', displayName: 'Mallory', keys: [{ publicKey: keys.a1 }] },
            {
                account: 'broken@remote.example',
                displayName: null,
                keys: [{ publicKey: 'short' }, { publicKey: keys.r4, revokedAt: 'garbage' }],
            },
        ];
        await Promise.all(
            bindings.map((b) =>
                db.execute(sql`
                    INSERT INTO author_bindings (account, keys, display_name, fetched_at)
                    VALUES (${b.account}, ${JSON.stringify(b.keys)}::jsonb, ${b.displayName}, ${FETCHED.toISOString()})
                `),
            ),
        );

        const legacy = legacySources(db);
        const legacyDirectory = directoryOf(legacy.findLocalAccount, legacy.bindings);
        before.checks = await checkAll(legacyDirectory.isAuthorKey, authors, allKeys);
        before.aliceList = signingKeyListOf(
            `alice@${DOMAIN}`,
            (await legacy.listByHandle('alice')) ?? [],
            new Date(NOW),
        );
        before.carolList = signingKeyListOf(
            `carol@${DOMAIN}`,
            (await legacy.listByHandle('carol')) ?? [],
            new Date(NOW),
        );

        await migrate(db, { migrationsFolder: MIGRATIONS });
    });

    afterAll(async () => {
        await scratch.drop?.();
        for (const dir of folders) rmSync(dir, { recursive: true, force: true });
    });

    const repositoryOf = () => createAuthorKeyRepository(() => scratch.db as Database);
    const findUserByHandle = async (handle: string) => {
        const rows = await (scratch.db as Database).execute<{ id: string; name: string }>(
            sql`SELECT id, name FROM users WHERE handle = ${handle}`,
        );
        return rows[0];
    };
    const sourcesOf = (warnings: string[] = []) =>
        authorKeySources({ repository: repositoryOf(), findUserByHandle, warn: (m) => warnings.push(m) });

    it('自サーバーの鍵は id・種類・名前・トークン・時刻・取り消しの理由ごと移り、account は持たない', async () => {
        const rows = await (scratch.db as Database).execute<{
            id: string;
            account: string | null;
            origin: string;
            user_id: string;
            kind: string;
            public_key: string;
            api_token_hash: string | null;
            revoke_reason: string | null;
        }>(sql`SELECT * FROM author_keys WHERE origin = 'local' ORDER BY id`);
        expect(rows.map((r) => r.id)).toEqual(['pe_a1', 'pe_a2', 'pe_a3', 'pe_a4', 'pe_b1', 'pe_c1']);
        expect(rows.every((r) => r.account === null)).toBe(true);
        expect(rows.find((r) => r.id === 'pe_a2')).toMatchObject({ api_token_hash: 'token_a2', revoke_reason: 'lost' });
        expect(rows.find((r) => r.id === 'pe_a3')?.revoke_reason).toBe('compromised');
        expect(rows.find((r) => r.id === 'pe_b1')?.user_id).toBe(bob.id);
        // 余りの bit が立っていた鍵は正規形で入る
        expect(rows.find((r) => r.id === 'pe_c1')?.public_key).toBe(keys.c1);

        const a2 = (await repositoryOf().listByUser(alice.id)).find((k) => k.id === 'pe_a2');
        expect(a2).toMatchObject({
            lastUsedAt: at('2026-09-03T00:00:00Z'),
            revokedAt: at('2026-09-04T00:00:00Z'),
        });
        expect(await repositoryOf().findActiveByTokenHash('token_a2')).toBeUndefined();
    });

    it('他サーバーの鍵は正規化して重なりをまとめ、読めない鍵は捨て、読めない取り消し時刻は確認時刻で取り消す', async () => {
        const repository = repositoryOf();
        const r1 = await repository.findRemoteAuthor('remote1@remote.example');
        expect(r1).toMatchObject({ displayName: 'リモート', fetchedAt: FETCHED });
        expect(
            Object.fromEntries(
                (r1?.keys ?? []).map((k) => [
                    k.publicKey,
                    [k.createdAt.toISOString(), k.revokedAt?.toISOString() ?? null],
                ]),
            ),
        ).toEqual({
            [keys.r1]: ['2026-07-01T00:00:00.000Z', null],
            [keys.r2]: ['2026-07-02T00:00:00.000Z', '2026-07-03T00:00:00.000Z'],
            [keys.r3]: [FETCHED.toISOString(), '2026-07-04T00:00:00.000Z'],
        });
        expect(await repository.findRemoteAuthor('empty@remote.example')).toMatchObject({
            displayName: null,
            keys: [],
        });
        const broken = await repository.findRemoteAuthor('broken@remote.example');
        expect(broken?.keys.map((k) => [k.publicKey, k.revokedAt?.toISOString()])).toEqual([
            [keys.r4, FETCHED.toISOString()],
        ]);
        expect((await repository.findRemoteAuthor('mallory@evil.example'))?.keys[0]?.claimsLocalKey).toBe(true);
    });

    it('作者の確認の結果は移行の前と同じ（意図して変えた 3 点を除く）', async () => {
        const { findLocalAccount, bindings } = sourcesOf();
        const directory = directoryOf(findLocalAccount, bindings);
        const after = await checkAll(withNormalizedKey(directory.isAuthorKey), authors, allKeys);
        const checkedAt = { status: 'confirmed', checkedAt: FETCHED.toISOString() };
        expect(after).toEqual({
            ...before.checks,
            // 1. 同じ鍵の別の書き方は同じ鍵（移行前は保存した文字列と完全一致のときだけ）
            [`carol@${DOMAIN} ${keys.c1}`]: { status: 'confirmed' },
            [`remote1@remote.example ${extraBitsOf(keys.r3)}`]: { status: 'unconfirmed' },
            // 2. 他サーバーがこのサーバーの鍵を名乗っても作者を付けない（移行前は付いていた）
            [`mallory@evil.example ${keys.a1}`]: { status: 'unconfirmed' },
        });
        // 移行前に付いていたことを確かめておく（上の上書きが意味のある差であること）
        expect(before.checks?.[`mallory@evil.example ${keys.a1}`]).toEqual(checkedAt);
        expect(before.checks?.[`carol@${DOMAIN} ${keys.c1}`]).toEqual({ status: 'unconfirmed' });
        // 3. r3 は正規化すると「有効」と「取り消し」が重なり、取り消しにまとまる（移行前は別の書き方だけ有効に見えた）
        expect(before.checks?.[`remote1@remote.example ${extraBitsOf(keys.r3)}`]).toEqual(checkedAt);
        expect(after[`remote1@remote.example ${keys.r3}`]).toEqual({ status: 'unconfirmed' });
        // 変わらないものの例
        expect(after[`alice@${DOMAIN} ${keys.a1}`]).toEqual({ status: 'confirmed' });
        expect(after[`alice@${DOMAIN} ${keys.a2}`]).toEqual({ status: 'unconfirmed' });
        expect(after[`remote1@remote.example ${keys.r1}`]).toEqual(checkedAt);
        expect(after[`bob@${DOMAIN} ${keys.b1}`]).toEqual({ status: 'unconfirmed' });
    });

    it('鍵一覧の文書（WebFinger から辿る）は移行の前と同じ。正規化した鍵だけが書き方を変える', async () => {
        const repository = repositoryOf();
        expect(signingKeyListOf(`alice@${DOMAIN}`, await repository.listByUser(alice.id), new Date(NOW))).toEqual(
            before.aliceList,
        );
        const carolAfter = signingKeyListOf(`carol@${DOMAIN}`, await repository.listByUser(carol.id), new Date(NOW));
        expect(carolAfter).toEqual({
            ...(before.carolList as object),
            keys: [{ publicKey: keys.c1, addedAt: '2026-09-08T00:00:00.000Z' }],
        });
    });

    it('handle が未設定のユーザーの鍵も移り、handle を決めると作者の鍵として使える', async () => {
        const db = scratch.db as Database;
        await db.execute(sql`UPDATE users SET handle = 'bob' WHERE id = ${bob.id}`);
        const { findLocalAccount, bindings } = sourcesOf();
        const directory = directoryOf(findLocalAccount, bindings);
        expect(await directory.isAuthorKey(`bob@${DOMAIN}`, keys.b1, 'sha256-x')).toEqual({ status: 'confirmed' });
    });

    it('移行の後、他サーバーがこのサーバーの鍵を名乗る一覧を保存すると警告を記録する', async () => {
        const warnings: string[] = [];
        const { bindings } = sourcesOf(warnings);
        await bindings.save('mallory@evil.example', { keys: [{ publicKey: standardOf(keys.a3) }] });
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(keys.a3);
    });
});

describe.skipIf(!RUN)('0020_author_keys の移行で止まる場合 (DB統合)', () => {
    it('自サーバーで同じ鍵を別の書き方で 2 回登録していたら、何も変えずに止める', async () => {
        const { db, drop } = await createScratchDatabase(`ubichill_ak_dup_${stamp}`);
        const upTo19 = migrationsUpTo('0019_pending_registrations');
        try {
            await migrate(db, { migrationsFolder: upTo19 });
            const key = newKey();
            await db.execute(sql`
                INSERT INTO users (id, name, email, email_verified, handle) VALUES
                    ('u1', 'One', 'one@example.com', true, 'one'), ('u2', 'Two', 'two@example.com', true, 'two')
            `);
            await db.execute(sql`
                INSERT INTO publishing_environments (id, user_id, kind, name, public_key) VALUES
                    ('p1', 'u1', 'browser', 'b', ${key}), ('p2', 'u2', 'browser', 'b', ${extraBitsOf(key)})
            `);
            await expect(migrate(db, { migrationsFolder: MIGRATIONS })).rejects.toThrow();
            const tables = await db.execute<{ name: string | null }>(
                sql`SELECT to_regclass('author_keys')::text AS name`,
            );
            expect(tables[0]?.name).toBeNull();
        } finally {
            await drop();
            rmSync(upTo19, { recursive: true, force: true });
        }
    });
});
