import { createAuthorKeyDirectory } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { claimedLocalKeysWarning, remoteKeyEntriesOf, type StoredRemoteKey } from './authorKeys';

const LOCAL_KEY = 'zrAOWmvHfxcn2wxizz6yonJ_OmzgO6eIdPdTFgBUwng';
const REMOTE_KEY = 'A'.repeat(43);
const NOW = Date.parse('2026-10-16T00:00:00.000Z');
const FETCHED = new Date(NOW - 60_000);
const ADDED = new Date('2026-09-01T00:00:00.000Z');

const key = (overrides: Partial<StoredRemoteKey>): StoredRemoteKey => ({
    publicKey: REMOTE_KEY,
    createdAt: ADDED,
    revokedAt: null,
    claimsLocalKey: false,
    ...overrides,
});

describe('remoteKeyEntriesOf', () => {
    it('保存した鍵を鍵一覧の形にする（取り消しはそのまま）', () => {
        const revoked = new Date('2026-09-10T00:00:00.000Z');
        expect(remoteKeyEntriesOf([key({}), key({ publicKey: LOCAL_KEY, revokedAt: revoked })], FETCHED)).toEqual([
            { publicKey: REMOTE_KEY, addedAt: ADDED.toISOString() },
            { publicKey: LOCAL_KEY, addedAt: ADDED.toISOString(), revokedAt: revoked.toISOString() },
        ]);
    });

    it('自サーバーの公開環境の鍵を名乗る鍵は、取り消し扱いにする（一覧からは外さない）', () => {
        expect(remoteKeyEntriesOf([key({ publicKey: LOCAL_KEY, claimsLocalKey: true })], FETCHED)).toEqual([
            { publicKey: LOCAL_KEY, addedAt: ADDED.toISOString(), revokedAt: FETCHED.toISOString() },
        ]);
    });

    it('取り消し済みの鍵は、名乗りでも元の取り消し時刻のまま', () => {
        const revoked = new Date('2026-09-10T00:00:00.000Z');
        expect(
            remoteKeyEntriesOf([key({ publicKey: LOCAL_KEY, claimsLocalKey: true, revokedAt: revoked })], FETCHED)[0]
                ?.revokedAt,
        ).toBe(revoked.toISOString());
    });
});

describe('他サーバーが自サーバーの鍵を名乗る場合の作者の確認（shared の規則と組み合わせる）', () => {
    const directoryWith = (keys: StoredRemoteKey[]) => {
        const fetchJson = vi.fn(async () => undefined);
        const directory = createAuthorKeyDirectory({
            bindings: {
                find: async () => ({ keys: remoteKeyEntriesOf(keys, FETCHED), fetchedAt: FETCHED }),
                save: async () => undefined,
            },
            confirmedContents: { record: async () => undefined, has: async () => false },
            fetchJson,
            allowHttp: false,
            now: () => NOW,
        });
        return { directory, fetchJson };
    };

    it('名乗った鍵では作者を付けず、知らない鍵として取り直しにも行かない', async () => {
        const { directory, fetchJson } = directoryWith([
            key({ publicKey: LOCAL_KEY, claimsLocalKey: true }),
            key({ publicKey: REMOTE_KEY }),
        ]);
        expect(await directory.isAuthorKey('mallory@evil.example', LOCAL_KEY, 'sha256-x')).toEqual({
            status: 'unconfirmed',
        });
        expect(fetchJson).not.toHaveBeenCalled();
        // 同じアカウントのほかの鍵は使える
        expect((await directory.isAuthorKey('mallory@evil.example', REMOTE_KEY, 'sha256-x')).status).toBe('confirmed');
    });
});

describe('claimedLocalKeysWarning', () => {
    it('名乗った鍵があるときだけ、アカウントと鍵を含む警告を返す', () => {
        expect(claimedLocalKeysWarning('mallory@evil.example', [])).toBeUndefined();
        const warning = claimedLocalKeysWarning('mallory@evil.example', [LOCAL_KEY]);
        expect(warning).toContain('mallory@evil.example');
        expect(warning).toContain(LOCAL_KEY);
    });
});
