import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    provision: vi.fn(async () => ({ base: 'http://owner', gen: 1, epoch: 1 })),
    close: vi.fn(async () => true),
    ticket: vi.fn(async () => ({ ticket: 't' })),
    findValidInvite: vi.fn(async () => undefined),
    friendIdsOf: vi.fn(async (): Promise<Set<string>> => new Set()),
    presence: vi.fn(async () => new Map()),
    roomPresence: vi.fn(async (id: string) => new Map([[id, { id, memberIds: ['bob'], emptySince: 0 }]])),
    getWorldByUrl: vi.fn(async () => ({ id: 'w', version: '1', displayName: 'W' })),
    resolveRefDetailed: vi.fn(async () => ({
        ok: true,
        world: {
            id: 'w',
            url: 'https://example.test/worlds/w',
            version: '1',
            displayName: 'W',
            capacity: { default: 4, max: 8 },
        },
    })),
    create: vi.fn(async (input: Record<string, unknown>) => ({
        ...input,
        id: 'room-new',
        createdAt: new Date(0),
        expiresAt: null,
    })),
}));

vi.mock('@ubichill/db', () => ({
    instanceRepository: { findById: mocks.findById, create: mocks.create },
    inviteRepository: { findValid: mocks.findValidInvite },
}));
vi.mock('../../config', () => ({ appConfig: { runtime: { publicUrl: '/ws' } } }));
vi.mock('../social/friends/friends', () => ({ friendIdsOf: mocks.friendIdsOf }));
vi.mock('../worlds/worldRegistry', () => ({
    worldRegistry: { getWorldByUrl: mocks.getWorldByUrl, resolveRefDetailed: mocks.resolveRefDetailed },
}));
vi.mock('./instanceRuntime', () => ({
    instanceRuntime: {
        presence: mocks.presence,
        roomPresence: mocks.roomPresence,
        provision: mocks.provision,
        close: mocks.close,
        ticket: mocks.ticket,
    },
}));

import { instanceManager } from './instanceManager';

const room = (accessType: string, leaderId = 'leader') => ({
    id: 'room-1',
    accessType,
    leaderId,
    maxUsers: 4,
    accessTags: [],
    createdAt: new Date(0),
    expiresAt: null,
    worldRef: 'https://example.test/worlds/w',
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('instanceManager.canJoin（公開範囲の判定に要るものだけ引く）', () => {
    it('パブリックの部屋では、見る人のフレンドを引かない', async () => {
        mocks.findById.mockResolvedValueOnce(room('public'));
        expect(await instanceManager.canJoin('room-1', 'alice')).toBe(true);
        expect(mocks.friendIdsOf).not.toHaveBeenCalled();
    });

    it('フレンドのみの部屋では、フレンドを引いて決める', async () => {
        mocks.findById.mockResolvedValue(room('friend_only'));
        mocks.friendIdsOf.mockResolvedValueOnce(new Set(['leader']));
        expect(await instanceManager.canJoin('room-1', 'alice')).toBe(true);
        mocks.friendIdsOf.mockResolvedValueOnce(new Set(['someone-else']));
        expect(await instanceManager.canJoin('room-1', 'alice')).toBe(false);
        expect(mocks.friendIdsOf).toHaveBeenCalledWith('alice');
    });

    it('フレンド+・招待のみの部屋でもフレンドを引く（中にいる人のフレンドに見える）', async () => {
        for (const accessType of ['friend_plus', 'invite_only']) {
            mocks.findById.mockResolvedValueOnce(room(accessType));
            await instanceManager.canJoin('room-1', 'alice');
        }
        expect(mocks.friendIdsOf).toHaveBeenCalledTimes(2);
    });
});

describe('在席は、その部屋の分だけ読む（全部屋を読み直さない）', () => {
    it('入れるかの判定', async () => {
        mocks.findById.mockResolvedValueOnce(room('friend_plus'));
        mocks.friendIdsOf.mockResolvedValueOnce(new Set(['bob']));
        expect(await instanceManager.canJoin('room-1', 'alice')).toBe(true);
        expect(mocks.roomPresence).toHaveBeenCalledWith('room-1');
        expect(mocks.presence).not.toHaveBeenCalled();
    });

    it('詳細（GET /instances/:id）。参加者の数もその部屋の在席から出す', async () => {
        mocks.findById.mockResolvedValue(room('public'));
        const instance = await instanceManager.getInstanceFor('room-1', 'alice');
        expect(instance?.stats.currentUsers).toBe(1);
        expect(instance?.canJoin).toBe(true);
        expect(mocks.presence).not.toHaveBeenCalled();
        // 判定と人数で同じ在席を使う（1 回だけ読む）
        expect(mocks.roomPresence).toHaveBeenCalledTimes(1);
    });

    it('部屋の在席が無ければ 0 人として扱う', async () => {
        mocks.findById.mockResolvedValue(room('public'));
        mocks.roomPresence.mockResolvedValueOnce(new Map());
        expect((await instanceManager.getInstanceFor('room-1', null))?.stats.currentUsers).toBe(0);
    });
});

describe('入室で部屋を置いている間に部屋が消えたら（終了・作成者の退会）', () => {
    it('Go の部屋を閉じて入れない（DB の行の無い部屋を Go に残さない）', async () => {
        // 入れるかを確かめた時点では行があり、Go に置いた後に見直すと消えている
        mocks.findById.mockResolvedValueOnce(room('public')).mockResolvedValueOnce(undefined);
        await expect(instanceManager.join('room-1', { id: 'alice', name: 'Alice' })).rejects.toThrow('入れません');
        expect(mocks.provision).toHaveBeenCalledTimes(1);
        expect(mocks.close).toHaveBeenCalledWith('room-1');
        expect(mocks.ticket).not.toHaveBeenCalled();
    });

    it('行が残っていれば閉じずにチケットを出す', async () => {
        mocks.findById.mockResolvedValue(room('public'));
        await instanceManager.join('room-1', { id: 'alice', name: 'Alice' });
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.ticket).toHaveBeenCalledTimes(1);
    });
});

describe('作成（ポータルの先の部屋は空でもしばらく残す）', () => {
    const T0 = Date.UTC(2026, 0, 1);
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
        mocks.findById.mockResolvedValue(room('public'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('holdEmptyMs があれば、作った時刻からその分を held_until にする', async () => {
        await instanceManager.createInstance({ worldId: 'w', holdEmptyMs: 60_000 }, 'leader');
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ heldUntil: new Date(T0 + 60_000) }));
    });

    it('holdEmptyMs が無ければ held_until は付けない（ふつうの部屋・ホーム）', async () => {
        await instanceManager.createInstance({ worldId: 'w' }, 'leader');
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ heldUntil: null }));
    });

    it('held_until は公開する部屋の情報に出さない', async () => {
        const created = await instanceManager.createInstance({ worldId: 'w', holdEmptyMs: 1 }, 'leader');
        expect(created).not.toHaveProperty('heldUntil');
    });
});

describe('作成（ワールドの公開範囲）', () => {
    const world = (visibility?: 'private' | 'public') => ({
        ok: true as const,
        world: {
            id: 'w',
            url: 'https://example.test/worlds/w',
            version: '1',
            displayName: 'W',
            capacity: { default: 4, max: 8 },
            authorId: 'aya',
            ...(visibility ? { visibility } : {}),
        },
    });
    beforeEach(() => {
        mocks.create.mockClear();
        mocks.findById.mockResolvedValue(room('public'));
    });

    it('プライベートのワールドは、作者でなければ作らずに断る（forbidden）', async () => {
        mocks.resolveRefDetailed.mockResolvedValueOnce(world('private'));
        const result = await instanceManager.createInstance({ worldId: 'w' }, 'bob');
        expect(result).toEqual({ error: expect.stringContaining('プライベート'), reason: 'forbidden' });
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('プライベートのワールドでも作者は作れ、部屋の情報に公開範囲が付く', async () => {
        mocks.resolveRefDetailed.mockResolvedValueOnce(world('private'));
        const created = await instanceManager.createInstance({ worldId: 'w' }, 'aya');
        expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ leaderId: 'aya' }));
        expect(created).toHaveProperty('world.visibility', 'private');
    });

    it('公開範囲を持たない（外部・同梱の）ワールドはだれでも作れ、公開範囲は付けない', async () => {
        mocks.resolveRefDetailed.mockResolvedValueOnce(world());
        const created = await instanceManager.createInstance({ worldId: 'w' }, 'bob');
        expect(mocks.create).toHaveBeenCalled();
        expect(created).not.toHaveProperty('world.visibility');
    });
});
