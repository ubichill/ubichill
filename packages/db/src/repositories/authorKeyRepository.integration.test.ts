import { generateKeyPairSync } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { authorKeys, remoteAuthors, users } from '../schema';
import { authorKeyRepository } from './authorKeyRepository';

/** 作者の鍵（author_keys・remote_authors）の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const newKey = (): string => generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x ?? '';
/** 同じ鍵の別の書き方（標準の base64・パディング付き）。 */
const standardOf = (key: string): string => Buffer.from(key, 'base64url').toString('base64');
/** 同じ鍵の別の書き方（32 byte に入らない余りの bit を立てる）。 */
const extraBitsOf = (key: string): string => `${key.slice(0, 42)}${BASE64URL[BASE64URL.indexOf(key[42]) + 3]}`;

describe.skipIf(!RUN)('authorKeyRepository (DB統合)', () => {
    const alice = `ak_alice_${stamp}`;
    const bob = `ak_bob_${stamp}`;
    const remoteA = `ak_a_${stamp}@other.example`;
    const remoteB = `ak_b_${stamp}@another.example`;

    beforeAll(async () => {
        await db.insert(users).values([
            { id: alice, name: 'Alice', email: `${alice}@example.com`, handle: alice },
            // handle が未設定でも鍵は持てる（ブラウザの公開環境は handle を決める前に登録できる）
            { id: bob, name: 'Bob', email: `${bob}@example.com` },
        ]);
    });

    afterAll(async () => {
        await db.delete(users).where(inArray(users.id, [alice, bob]));
        await db.delete(authorKeys).where(inArray(authorKeys.account, [remoteA, remoteB]));
        await db.delete(remoteAuthors).where(inArray(remoteAuthors.account, [remoteA, remoteB]));
    });

    it('鍵は正規化して保存し、どの書き方でも同じ鍵として引ける', async () => {
        const key = newKey();
        const created = await authorKeyRepository.createLocal({
            userId: bob,
            kind: 'browser',
            name: 'Chrome on Mac',
            publicKey: `ed25519:${standardOf(key)}`,
        });
        expect(created.publicKey).toBe(key);
        for (const variant of [key, standardOf(key), extraBitsOf(key), `ed25519:${key}`]) {
            expect((await authorKeyRepository.findLocalKey(variant))?.id).toBe(created.id);
        }
        expect(await authorKeyRepository.findLocalKey('short')).toBeUndefined();
    });

    it('同じ鍵を同じアカウントに登録し直せない（取り消した後でも、書き方を変えても）', async () => {
        const key = newKey();
        const created = await authorKeyRepository.createLocal({
            userId: alice,
            kind: 'cli',
            name: 'cli',
            publicKey: key,
        });
        const again = { userId: alice, kind: 'browser', name: 'again', publicKey: extraBitsOf(key) };
        await expect(authorKeyRepository.createLocal(again)).rejects.toThrow();
        await authorKeyRepository.revoke(alice, created.id, 'lost');
        await expect(authorKeyRepository.createLocal({ ...again, publicKey: standardOf(key) })).rejects.toThrow();
    });

    it('別の自サーバーのアカウントに同じ鍵を登録できない', async () => {
        const key = newKey();
        await authorKeyRepository.createLocal({ userId: alice, kind: 'browser', name: 'a', publicKey: key });
        await expect(
            authorKeyRepository.createLocal({ userId: bob, kind: 'browser', name: 'b', publicKey: standardOf(key) }),
        ).rejects.toThrow();
    });

    it('正規形でない鍵は DB が受け付けない（リポジトリを通さずに書いても）', async () => {
        const key = newKey();
        const base = {
            id: `raw_${stamp}`,
            origin: 'local',
            algorithm: 'ed25519',
            userId: bob,
            kind: 'ci',
            name: 'raw',
        };
        await expect(db.insert(authorKeys).values({ ...base, publicKey: extraBitsOf(key) })).rejects.toThrow();
        await expect(db.insert(authorKeys).values({ ...base, publicKey: standardOf(key) })).rejects.toThrow();
        await expect(
            db.insert(authorKeys).values({ ...base, origin: 'remote', account: remoteA, publicKey: key }),
        ).rejects.toThrow();
    });

    it('取り消しは本人の未取り消しのものだけ。revokeAllForUser は取り消した数を返し、既存の取り消しは変えない', async () => {
        const user = `ak_rev_${stamp}`;
        await db.insert(users).values({ id: user, name: 'Rev', email: `${user}@example.com`, handle: user });
        try {
            const lostAt = new Date('2026-10-01T00:00:00.000Z');
            const [k1, k2, k3] = await Promise.all(
                ['browser', 'cli', 'ci'].map((kind) =>
                    authorKeyRepository.createLocal({
                        userId: user,
                        kind,
                        name: kind,
                        publicKey: newKey(),
                        apiTokenHash: kind === 'browser' ? undefined : `hash_${kind}_${stamp}`,
                    }),
                ),
            );
            expect(await authorKeyRepository.revoke(alice, k1.id, 'lost')).toBeUndefined();
            expect((await authorKeyRepository.revoke(user, k1.id, 'lost', lostAt))?.revokeReason).toBe('lost');
            expect(await authorKeyRepository.revoke(user, k1.id, 'compromised')).toBeUndefined();
            expect(await authorKeyRepository.findActiveByTokenHash(`hash_cli_${stamp}`)).toMatchObject({ id: k2.id });

            expect(await authorKeyRepository.revokeAllForUser(user, 'compromised')).toBe(2);
            expect(await authorKeyRepository.revokeAllForUser(user, 'compromised')).toBe(0);
            const after = new Map((await authorKeyRepository.listByUser(user)).map((k) => [k.id, k]));
            expect(after.get(k1.id)).toMatchObject({ revokeReason: 'lost', revokedAt: lostAt });
            expect(after.get(k2.id)?.revokeReason).toBe('compromised');
            expect(after.get(k3.id)?.revokeReason).toBe('compromised');
            expect(await authorKeyRepository.findActiveByTokenHash(`hash_cli_${stamp}`)).toBeUndefined();
        } finally {
            await db.delete(users).where(eq(users.id, user));
        }
    });

    it('他サーバーの別のアカウントが同じ鍵を名乗る行は、両方とも保存できる', async () => {
        const key = newKey();
        await authorKeyRepository.saveRemoteAuthor(remoteA, { keys: [{ publicKey: key }], displayName: 'A' });
        await authorKeyRepository.saveRemoteAuthor(remoteB, { keys: [{ publicKey: standardOf(key) }] });
        expect((await authorKeyRepository.findRemoteAuthor(remoteA))?.keys.map((k) => k.publicKey)).toEqual([key]);
        expect((await authorKeyRepository.findRemoteAuthor(remoteB))?.keys.map((k) => k.publicKey)).toEqual([key]);
    });

    it('他サーバーが自サーバーの鍵を名乗ると、行は保存するが名乗った鍵として返す', async () => {
        const localKey = newKey();
        const ownKey = newKey();
        await authorKeyRepository.createLocal({ userId: alice, kind: 'browser', name: 'x', publicKey: localKey });
        const result = await authorKeyRepository.saveRemoteAuthor(remoteA, {
            keys: [{ publicKey: extraBitsOf(localKey) }, { publicKey: ownKey }],
            displayName: 'A',
        });
        expect(result.claimedLocalKeys).toEqual([localKey]);
        const found = await authorKeyRepository.findRemoteAuthor(remoteA);
        expect(found?.keys).toHaveLength(2);
        expect(found?.keys.find((k) => k.publicKey === localKey)?.claimsLocalKey).toBe(true);
        expect(found?.keys.find((k) => k.publicKey === ownKey)?.claimsLocalKey).toBe(false);
    });

    it('取り直した一覧で置き換える（消えた鍵は消え、表示名と確認時刻も変わる。鍵が無くてもアカウントは残る）', async () => {
        const k1 = newKey();
        const k2 = newKey();
        const first = new Date('2026-10-01T00:00:00.000Z');
        const second = new Date('2026-10-02T00:00:00.000Z');
        await authorKeyRepository.saveRemoteAuthor(remoteB, { keys: [{ publicKey: k1 }], displayName: 'B' }, first);
        await authorKeyRepository.saveRemoteAuthor(
            remoteB,
            { keys: [{ publicKey: k1, revokedAt: '2026-10-01T12:00:00.000Z' }, { publicKey: k2 }], displayName: 'B2' },
            second,
        );
        const found = await authorKeyRepository.findRemoteAuthor(remoteB);
        expect(found).toMatchObject({ displayName: 'B2', fetchedAt: second });
        expect(found?.keys.map((k) => [k.publicKey, k.revokedAt?.toISOString() ?? null]).sort()).toEqual(
            [
                [k1, '2026-10-01T12:00:00.000Z'],
                [k2, null],
            ].sort(),
        );

        await authorKeyRepository.saveRemoteAuthor(remoteB, { keys: [] }, second);
        expect(await authorKeyRepository.findRemoteAuthor(remoteB)).toMatchObject({ displayName: null, keys: [] });
        expect(await authorKeyRepository.findRemoteAuthor(`none_${stamp}@other.example`)).toBeUndefined();
    });

    it('同じアカウントを同時に保存しても一意制約で失敗しない', async () => {
        const keys = [{ publicKey: newKey() }, { publicKey: newKey() }];
        await Promise.all(
            Array.from({ length: 5 }, () => authorKeyRepository.saveRemoteAuthor(remoteA, { keys, displayName: 'A' })),
        );
        expect((await authorKeyRepository.findRemoteAuthor(remoteA))?.keys).toHaveLength(2);
    });

    it('確認済みの内容はアカウントと内容の組で記録し、二重に記録しても失敗しない', async () => {
        const account = `ak_c_${stamp}@other.example`;
        expect(await authorKeyRepository.hasConfirmedContent(account, 'sha256-a')).toBe(false);
        await authorKeyRepository.recordConfirmedContent(account, 'sha256-a');
        await authorKeyRepository.recordConfirmedContent(account, 'sha256-a');
        expect(await authorKeyRepository.hasConfirmedContent(account, 'sha256-a')).toBe(true);
        expect(await authorKeyRepository.hasConfirmedContent(account, 'sha256-b')).toBe(false);
        expect(await authorKeyRepository.hasConfirmedContent(`other_${stamp}@other.example`, 'sha256-a')).toBe(false);
    });
});
