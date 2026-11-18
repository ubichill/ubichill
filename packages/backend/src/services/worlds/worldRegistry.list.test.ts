import { setTimeout as sleep } from 'node:timers/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    worldRepository: { findState: vi.fn(), findPublished: vi.fn() },
    userRepository: { findById: vi.fn() },
    federationPeerRepository: { findAll: vi.fn() },
}));
vi.mock('@ubichill/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@ubichill/db')>()),
    ...db,
    authorKeyRepository: {},
}));

import { worldRegistry } from './worldRegistry';

const record = (id: string) => ({
    id,
    authorId: 'author',
    worldName: id,
    currentVersionId: `v-${id}`,
    createdAt: new Date(0),
    updatedAt: new Date(0),
});
/** 作者のアカウントが無いワールドの状態（「配信しない」と解決され、その結果もキャッシュされる）。 */
const stateOf = (id: string) => ({
    world: record(id),
    draft: { worldId: id, definition: { metadata: { name: id, version: '1.0.0' } }, lock: null },
});

beforeEach(() => {
    vi.resetAllMocks();
    worldRegistry.invalidateResolvedWorlds();
    db.userRepository.findById.mockResolvedValue(undefined);
    db.worldRepository.findState.mockImplementation(async (id: string) => stateOf(id));
});

describe('GET /api/v1/worlds（このサーバーの一覧）', () => {
    it('公開中の版がある行だけを、上限つきで引く（下書きは解決しない）', async () => {
        db.worldRepository.findPublished.mockResolvedValue([record('a'), record('b')]);
        await worldRegistry.listWorlds('local');
        expect(db.worldRepository.findPublished).toHaveBeenCalledTimes(1);
        const [limit] = db.worldRepository.findPublished.mock.calls[0] as [number];
        expect(limit).toBeGreaterThan(0);
        expect(limit).toBeLessThanOrEqual(500);
        expect(db.worldRepository.findState.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    });

    it('キャッシュが冷えていても、一度に解決するのは 8 件まで', async () => {
        db.worldRepository.findPublished.mockResolvedValue(Array.from({ length: 30 }, (_, i) => record(`w${i}`)));
        const state = { active: 0, max: 0 };
        db.worldRepository.findState.mockImplementation(async (id: string) => {
            state.active += 1;
            state.max = Math.max(state.max, state.active);
            await sleep(2);
            state.active -= 1;
            return stateOf(id);
        });
        await worldRegistry.listWorlds('local');
        expect(db.worldRepository.findState).toHaveBeenCalledTimes(30);
        expect(state.max).toBeLessThanOrEqual(8);
    });

    it('同時に来た一覧は、同じワールドの解決を 1 回にまとめる', async () => {
        db.worldRepository.findPublished.mockResolvedValue([record('a'), record('b'), record('c')]);
        await Promise.all([1, 2, 3, 4, 5].map(() => worldRegistry.listWorlds('local')));
        expect(db.worldRepository.findState).toHaveBeenCalledTimes(3);
    });
});

describe('本体のワールドの解決キャッシュ', () => {
    it('同じワールドを同時に解決しても、DB に問い合わせるのは 1 回', async () => {
        await Promise.all(Array.from({ length: 20 }, () => worldRegistry.resolveLocal('same')));
        expect(db.worldRepository.findState).toHaveBeenCalledTimes(1);
    });

    it('解決している途中で変更の知らせが来たら、あとから来た解決は待たずに引き直す', async () => {
        const first = worldRegistry.resolveLocal('changing');
        worldRegistry.invalidateResolvedWorlds();
        await Promise.all([first, worldRegistry.resolveLocal('changing')]);
        expect(db.worldRepository.findState).toHaveBeenCalledTimes(2);
    });

    it('件数に上限がある（古いものから捨てる）', async () => {
        await worldRegistry.resolveLocal('oldest');
        for (const i of Array.from({ length: 2000 }, (_, n) => n)) await worldRegistry.resolveLocal(`w${i}`);
        await worldRegistry.resolveLocal('oldest');
        expect(db.worldRepository.findState.mock.calls.filter(([id]) => id === 'oldest')).toHaveLength(2);
    });

    it('上限までは捨てない', async () => {
        await worldRegistry.resolveLocal('kept');
        for (const i of Array.from({ length: 100 }, (_, n) => n)) await worldRegistry.resolveLocal(`w${i}`);
        await worldRegistry.resolveLocal('kept');
        expect(db.worldRepository.findState.mock.calls.filter(([id]) => id === 'kept')).toHaveLength(1);
    });
});
