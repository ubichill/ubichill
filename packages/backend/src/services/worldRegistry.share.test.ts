import type { ResolvedWorld } from '@ubichill/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    worldRepository: { findByAuthorAndWorldName: vi.fn(), findByAuthorAndAlias: vi.fn() },
    userRepository: { findByHandle: vi.fn() },
    externalWorkRepository: { listByUser: vi.fn() },
    federationPeerRepository: { findAll: vi.fn() },
}));
// servedWorldOf などの純粋な関数は本物を使う（接続は問い合わせるまで張らない）
vi.mock('@ubichill/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@ubichill/db')>()),
    ...db,
    authorKeyRepository: {},
}));

import { worldRegistry } from './worldRegistry';

const PAGES = 'https://ieyoukan.github.io/ubichill-worlds/worlds/chillwa.yaml';
const DOMAIN = 'ubichill.test';
const youkan = { id: 'u-youkan', handle: 'youkan' };

/** 外部ホストから解決したワールド（作者の署名を確かめた結果だけ差し替える）。 */
const remoteWorld = (identity: ResolvedWorld['identity']): ResolvedWorld =>
    ({
        url: PAGES,
        source: { kind: 'github', url: PAGES },
        id: 'chillwa',
        displayName: 'ちるわ',
        version: '1.1.0',
        capacity: { default: 10, max: 20 },
        mods: [],
        identity,
    }) as unknown as ResolvedWorld;

const verifiedBy = (author: string, name = 'chillwa'): ResolvedWorld['identity'] => ({
    status: 'verified',
    worldId: `acct:${author}/${name}`,
    publicKey: 'A'.repeat(43),
    contentHash: `sha256-${'B'.repeat(43)}=`,
    author,
});

/**
 * 共有 URL（/@handle/name）で、作者がユーザーページに登録した外部のワールドを開けること。
 * 開けるのは、その作者の署名で、その名前のワールドだと確かめられたときだけ（ユーザーページに出す条件と同じ）。
 */
describe('作者が登録した外部のワールドの共有 URL', () => {
    const previous = process.env.PUBLIC_BASE_URL;
    beforeAll(() => {
        process.env.PUBLIC_BASE_URL = `https://${DOMAIN}`;
    });
    afterAll(() => {
        process.env.PUBLIC_BASE_URL = previous;
    });
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.resetAllMocks();
        db.worldRepository.findByAuthorAndWorldName.mockResolvedValue(undefined);
        db.worldRepository.findByAuthorAndAlias.mockResolvedValue(undefined);
        db.userRepository.findByHandle.mockImplementation(async (h: string) => (h === 'youkan' ? youkan : undefined));
        db.externalWorkRepository.listByUser.mockResolvedValue([
            { userId: youkan.id, kind: 'world', url: PAGES, name: 'chillwa', version: null, registeredAt: new Date() },
        ]);
    });

    it('本体に無ければ、登録した外部のワールドを作者の署名で確かめて返し、短い共有パスも付けられる', async () => {
        vi.spyOn(worldRegistry, 'resolveRemote').mockResolvedValue({
            ok: true,
            world: remoteWorld(verifiedBy(`youkan@${DOMAIN}`)),
        });
        const resolution = await worldRegistry.resolveByAuthorName('youkan', 'chillwa');
        expect(resolution.ok && resolution.world.url).toBe(PAGES);
        if (!resolution.ok) throw new Error('解決できませんでした');
        expect(await worldRegistry.externalSharePath(resolution.world)).toBe('/@youkan/chillwa');
    });

    it('別の人の署名・署名なし・名前の違うワールドが登録した URL に置かれていたら開かない', async () => {
        for (const identity of [
            verifiedBy(`mallory@${DOMAIN}`),
            verifiedBy(`youkan@${DOMAIN}`, 'other'),
            { status: 'unsigned', contentHash: `sha256-${'B'.repeat(43)}=` } as const,
        ]) {
            vi.spyOn(worldRegistry, 'resolveRemote').mockResolvedValue({ ok: true, world: remoteWorld(identity) });
            expect((await worldRegistry.resolveByAuthorName('youkan', 'chillwa')).ok).toBe(false);
        }
    });

    it('登録していない名前・知らない作者は開かない（外部へ取りに行かない）', async () => {
        const remote = vi.spyOn(worldRegistry, 'resolveRemote');
        expect((await worldRegistry.resolveByAuthorName('youkan', 'not-registered')).ok).toBe(false);
        expect((await worldRegistry.resolveByAuthorName('nobody', 'chillwa')).ok).toBe(false);
        expect(remote).not.toHaveBeenCalled();
    });

    it('作者が確かめられても、その URL を登録していなければ短い共有パスは付けない（/@handle/name で開けないので）', async () => {
        db.externalWorkRepository.listByUser.mockResolvedValue([]);
        expect(await worldRegistry.externalSharePath(remoteWorld(verifiedBy(`youkan@${DOMAIN}`)))).toBeUndefined();
    });

    it('別のサーバーの作者のワールドには付けない', async () => {
        expect(await worldRegistry.externalSharePath(remoteWorld(verifiedBy('alice@other.example')))).toBeUndefined();
        expect(db.userRepository.findByHandle).not.toHaveBeenCalled();
    });
});
