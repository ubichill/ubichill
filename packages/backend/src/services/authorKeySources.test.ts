import type { AuthorKeyRepository } from '@ubichill/db';
import { describe, expect, it, vi } from 'vitest';
import { authorKeySources, withNormalizedKey } from './authorKeySources';

const KEY = 'zrAOWmvHfxcn2wxizz6yonJ_OmzgO6eIdPdTFgBUwng';
const FETCHED = new Date('2026-10-10T00:00:00.000Z');

/** 使うメソッドだけを持つ偽のリポジトリ（DB に触れない）。 */
function fakeRepository(overrides: Partial<AuthorKeyRepository>): AuthorKeyRepository {
    const unused = async () => {
        throw new Error('使わない');
    };
    return {
        listByUser: unused,
        findLocalKey: unused,
        createLocal: unused,
        revoke: unused,
        revokeAllForUser: unused,
        touch: unused,
        findActiveByTokenHash: unused,
        findRemoteAuthor: unused,
        saveRemoteAuthor: unused,
        recordConfirmedContent: unused,
        hasConfirmedContent: unused,
        ...overrides,
    };
}

describe('authorKeySources', () => {
    it('他サーバーが自サーバーの鍵を名乗る一覧を保存したら警告を記録する（保存はする）', async () => {
        const saveRemoteAuthor = vi.fn(async () => ({ claimedLocalKeys: [KEY] }));
        const warn = vi.fn();
        const sources = authorKeySources({
            repository: fakeRepository({ saveRemoteAuthor }),
            findUserByHandle: async () => undefined,
            warn,
        });
        await sources.bindings.save('mallory@evil.example', { keys: [{ publicKey: KEY }], displayName: 'M' });
        expect(saveRemoteAuthor).toHaveBeenCalledWith('mallory@evil.example', {
            keys: [{ publicKey: KEY }],
            displayName: 'M',
        });
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0]?.[0]).toContain('mallory@evil.example');
    });

    it('名乗りの無い一覧では警告しない', async () => {
        const warn = vi.fn();
        const sources = authorKeySources({
            repository: fakeRepository({ saveRemoteAuthor: async () => ({ claimedLocalKeys: [] }) }),
            findUserByHandle: async () => undefined,
            warn,
        });
        await sources.bindings.save('alice@other.example', { keys: [{ publicKey: KEY }] });
        expect(warn).not.toHaveBeenCalled();
    });

    it('保存した他サーバーの鍵は、名乗った鍵を取り消しとして返す', async () => {
        const sources = authorKeySources({
            repository: fakeRepository({
                findRemoteAuthor: async (account) => ({
                    account,
                    displayName: null,
                    fetchedAt: FETCHED,
                    keys: [{ publicKey: KEY, createdAt: FETCHED, revokedAt: null, claimsLocalKey: true }],
                }),
            }),
            findUserByHandle: async () => undefined,
            warn: () => undefined,
        });
        expect(await sources.bindings.find('mallory@evil.example')).toEqual({
            keys: [{ publicKey: KEY, addedAt: FETCHED.toISOString(), revokedAt: FETCHED.toISOString() }],
            displayName: undefined,
            fetchedAt: FETCHED,
        });
    });

    it('自サーバーのアカウントは handle から利用者を引き、その公開環境の鍵を返す（利用者がいなければ無し）', async () => {
        const listByUser = vi.fn(async () => [
            {
                id: 'k1',
                userId: 'u1',
                kind: 'browser',
                name: 'b',
                publicKey: KEY,
                apiTokenHash: null,
                createdAt: FETCHED,
                lastUsedAt: null,
                revokedAt: null,
                revokeReason: null,
            },
        ]);
        const sources = authorKeySources({
            repository: fakeRepository({ listByUser }),
            findUserByHandle: async (handle) => (handle === 'alice' ? { id: 'u1', name: 'アリス' } : undefined),
            warn: () => undefined,
        });
        expect(await sources.findLocalAccount('alice')).toEqual({
            keys: [{ publicKey: KEY, addedAt: FETCHED.toISOString() }],
            displayName: 'アリス',
        });
        expect(listByUser).toHaveBeenCalledWith('u1');
        expect(await sources.findLocalAccount('nobody')).toBeUndefined();
    });
});

describe('withNormalizedKey', () => {
    it('署名の鍵を正規化してから照合し、読めない鍵は照合せずに作者を付けない', async () => {
        const check = vi.fn(async () => ({ status: 'confirmed' }) as const);
        const normalized = withNormalizedKey(check);
        expect(await normalized('a@b.example', `ed25519:${KEY.slice(0, 42)}h`, 'sha256-x')).toEqual({
            status: 'confirmed',
        });
        expect(check).toHaveBeenCalledWith('a@b.example', KEY, 'sha256-x');
        expect(await normalized('a@b.example', 'short', 'sha256-x')).toEqual({ status: 'unconfirmed' });
        expect(check).toHaveBeenCalledOnce();
    });
});
