import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    findValidInvite: vi.fn(async () => undefined),
    friendIdsOf: vi.fn(async (): Promise<Set<string>> => new Set()),
    presence: vi.fn(async () => new Map()),
    roomPresence: vi.fn(async (id: string) => new Map([[id, { id, memberIds: ['bob'], emptySince: 0 }]])),
    getWorldByUrl: vi.fn(async () => ({ id: 'w', version: '1', displayName: 'W' })),
}));

vi.mock('@ubichill/db', () => ({
    instanceRepository: { findById: mocks.findById },
    inviteRepository: { findValid: mocks.findValidInvite },
}));
vi.mock('../../config', () => ({ appConfig: { runtime: { publicUrl: '/ws' } } }));
vi.mock('../social/friends/friends', () => ({ friendIdsOf: mocks.friendIdsOf }));
vi.mock('../worlds/worldRegistry', () => ({ worldRegistry: { getWorldByUrl: mocks.getWorldByUrl } }));
vi.mock('./instanceRuntime', () => ({
    instanceRuntime: { presence: mocks.presence, roomPresence: mocks.roomPresence },
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
