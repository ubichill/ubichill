import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    worldRepository: { findByName: vi.fn(), delete: vi.fn(), findAll: vi.fn() },
    userRepository: { findById: vi.fn(), findByHandle: vi.fn() },
    federationPeerRepository: { findAll: vi.fn(), delete: vi.fn() },
}));
vi.mock('@ubichill/db', () => ({
    ...db,
    authorKeyRepository: {},
}));

import { type BackendEvent, backendEvents, createMemoryBusHub } from './backendEvents';
import { worldRegistry } from './worldRegistry';

/**
 * ほかの backend（同じ hub の相手）との間で、ワールドのキャッシュの知らせを送る・受ける。
 * 本物の Redis の運び方は backendEvents.integration.test.ts が確かめる。
 */
describe('worldRegistry と backend の間の知らせ', () => {
    const hub = createMemoryBusHub();
    const other = hub.connect();
    const received: BackendEvent[] = [];
    const record = { id: 'db-1', name: 'w1', authorId: 'author-1', worldName: 'hello' };

    beforeAll(async () => {
        await backendEvents.attach(hub.connect());
        await other.subscribe((event) => received.push(event));
    });
    afterAll(async () => {
        await backendEvents.detach();
    });
    beforeEach(() => {
        vi.resetAllMocks();
        received.length = 0;
        db.worldRepository.findByName.mockResolvedValue(record);
        // 作者の ID が無いワールドは「配信しない」と解決され、その結果もキャッシュされる
        db.userRepository.findById.mockResolvedValue({ id: 'author-1', handle: null });
    });

    it('ほかの backend がワールドを変えたら、解決のキャッシュを捨てて DB から引き直す', async () => {
        await worldRegistry.resolveLocal('w2');
        await worldRegistry.resolveLocal('w2');
        expect(db.worldRepository.findByName).toHaveBeenCalledTimes(1);
        // 別のワールドの知らせでは捨てない
        await other.publish({ type: 'world.changed', worldId: 'other' });
        await sleep(10);
        await worldRegistry.resolveLocal('w2');
        expect(db.worldRepository.findByName).toHaveBeenCalledTimes(1);
        await other.publish({ type: 'world.changed', worldId: 'w2' });
        await sleep(10);
        await worldRegistry.resolveLocal('w2');
        expect(db.worldRepository.findByName).toHaveBeenCalledTimes(2);
    });

    it('作者の鍵・表示名が変わった知らせでも捨てる', async () => {
        await worldRegistry.resolveLocal('w1');
        const before = db.worldRepository.findByName.mock.calls.length;
        await other.publish({ type: 'worlds.resolved-stale' });
        await sleep(10);
        await worldRegistry.resolveLocal('w1');
        expect(db.worldRepository.findByName).toHaveBeenCalledTimes(before + 1);
    });

    it('削除したら、ほかの backend に知らせる', async () => {
        db.worldRepository.delete.mockResolvedValue(true);
        expect(await worldRegistry.deleteWorld('w1')).toBe(true);
        await sleep(10);
        expect(received).toEqual([{ type: 'world.changed', worldId: 'w1' }]);
    });

    it('作者の情報が変わったら、ほかの backend に知らせる', async () => {
        worldRegistry.invalidateResolvedWorlds();
        await sleep(10);
        expect(received).toEqual([{ type: 'worlds.resolved-stale' }]);
    });

    it('フォローの変更の知らせで、ピアを DB から読み直す', async () => {
        db.federationPeerRepository.findAll.mockResolvedValue([]);
        await other.publish({ type: 'peers.changed' });
        await sleep(10);
        expect(db.federationPeerRepository.findAll).toHaveBeenCalledTimes(1);
    });

    it('フォローを外したら、ほかの backend に知らせる', async () => {
        db.federationPeerRepository.delete.mockResolvedValue(true);
        await worldRegistry.unfollowPeer('peer-1');
        await sleep(10);
        expect(received).toEqual([{ type: 'peers.changed' }]);
    });
});
