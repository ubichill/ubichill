import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    findValidInvite: vi.fn(async () => undefined),
    friendIdsOf: vi.fn(async (): Promise<Set<string>> => new Set()),
    presence: vi.fn(async () => new Map()),
}));

vi.mock('@ubichill/db', () => ({
    instanceRepository: { findById: mocks.findById },
    inviteRepository: { findValid: mocks.findValidInvite },
}));
vi.mock('../../config', () => ({ appConfig: { runtime: { publicUrl: '/ws' } } }));
vi.mock('../social/friends/friends', () => ({ friendIdsOf: mocks.friendIdsOf }));
vi.mock('../worlds/worldRegistry', () => ({ worldRegistry: {} }));
vi.mock('./instanceRuntime', () => ({ instanceRuntime: { presence: mocks.presence } }));

import { instanceManager } from './instanceManager';

const room = (accessType: string, leaderId = 'leader') => ({
    id: 'room-1',
    accessType,
    leaderId,
    maxUsers: 4,
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
