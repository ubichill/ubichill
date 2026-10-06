import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    friendIdsOf: vi.fn(),
    getWorldByUrl: vi.fn(),
    presence: vi.fn(),
    provision: vi.fn(),
    ticket: vi.fn(),
}));
vi.mock('@ubichill/db', () => ({ instanceRepository: { findById: mocks.findById } }));
vi.mock('../config', () => ({ appConfig: { runtime: { publicUrl: '/realtime/v1/ws' } } }));
vi.mock('./worldRegistry', () => ({ worldRegistry: { getWorldByUrl: mocks.getWorldByUrl } }));
vi.mock('./friends', () => ({ friendIdsOf: mocks.friendIdsOf }));
vi.mock('./instanceRuntime', () => ({
    instanceRuntime: { presence: mocks.presence, provision: mocks.provision, ticket: mocks.ticket },
}));
vi.mock('./instanceReaper', () => ({ instanceReaper: { markCreated: vi.fn() } }));

import { InstanceJoinRejected, instanceManager } from './instanceManager';

const record = {
    id: 'room',
    leaderId: 'owner',
    accessType: 'friend_only',
    worldRef: 'https://world.test/room.yaml',
    maxUsers: 10,
    hasPassword: false,
};

describe('GoインスタンスへのSNS参加受付', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findById.mockResolvedValue(record);
        mocks.friendIdsOf.mockResolvedValue(new Set());
        mocks.presence.mockResolvedValue(new Map());
        mocks.getWorldByUrl.mockResolvedValue({ id: 'world' });
        mocks.ticket.mockResolvedValue({ token: 'ticket' });
    });
    it('フレンド条件を満たさない参加者にはチケットを発行しない', async () => {
        await expect(instanceManager.join('room', 'stranger')).rejects.toThrow(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
        expect(mocks.provision).not.toHaveBeenCalled();
    });
    it('フレンド+はGoが返した現在の参加者を使って判定する', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'friend_plus' });
        mocks.friendIdsOf.mockResolvedValue(new Set(['friend']));
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['friend'] }]]));
        await expect(instanceManager.join('room', 'visitor')).resolves.toEqual({ token: 'ticket' });
        expect(mocks.ticket).toHaveBeenCalledWith('room', 'visitor');
    });
    it('所有者でも部屋のパスワード確認を省略しない', async () => {
        mocks.findById.mockResolvedValue({ ...record, hasPassword: true });
        await expect(instanceManager.join('room', 'owner')).rejects.toThrow(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
    it('Goに接続できない場合に公開範囲を迂回しない', async () => {
        mocks.presence.mockRejectedValue(new Error('runtime unavailable'));
        const error = await instanceManager.join('room', 'owner').catch((e: unknown) => e);
        expect(error).not.toBeInstanceOf(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
    it('存在しないインスタンスは拒否として扱う', async () => {
        mocks.findById.mockResolvedValue(undefined);
        await expect(instanceManager.join('gone', 'owner')).rejects.toThrow(InstanceJoinRejected);
    });
    it('パスワード違いは拒否として扱い、チケットを発行しない', async () => {
        mocks.findById.mockResolvedValue({ ...record, hasPassword: true, passwordHash: 'x' });
        await expect(instanceManager.join('room', 'owner', 'wrong')).rejects.toThrow(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
    it('ワールドが解決できなければ参加チケットを発行しない（取得元の障害かもしれないので拒否扱いにしない）', async () => {
        mocks.getWorldByUrl.mockResolvedValue(null);
        const error = await instanceManager.join('room', 'owner').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
});
