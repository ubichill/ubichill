import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findById: vi.fn(),
    findValidInvite: vi.fn(),
    friendIdsOf: vi.fn(),
    getWorldByUrl: vi.fn(),
    presence: vi.fn(),
    provision: vi.fn(),
    ticket: vi.fn(),
    close: vi.fn(),
    deleteByLeader: vi.fn(),
}));
vi.mock('@ubichill/db', () => ({
    instanceRepository: { findById: mocks.findById, deleteByLeader: mocks.deleteByLeader },
    inviteRepository: { findValid: mocks.findValidInvite },
}));
vi.mock('../../config', () => ({ appConfig: { runtime: { publicUrl: '/realtime/v1/ws' } } }));
vi.mock('../worlds/worldRegistry', () => ({ worldRegistry: { getWorldByUrl: mocks.getWorldByUrl } }));
vi.mock('../social/friends', () => ({ friendIdsOf: mocks.friendIdsOf }));
vi.mock('./instanceRuntime', () => ({
    instanceRuntime: { presence: mocks.presence, provision: mocks.provision, ticket: mocks.ticket, close: mocks.close },
}));

import { InstanceJoinRejected, instanceManager, ticketName } from './instanceManager';

const record = {
    id: 'room',
    leaderId: 'owner',
    accessType: 'friend_only',
    worldRef: 'https://world.test/room.yaml',
    maxUsers: 10,
    passwordHash: null,
};
const owner = { base: 'http://10.0.0.7:3002', gen: 'g1', epoch: 2 };

describe('GoインスタンスへのSNS参加受付', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findById.mockResolvedValue(record);
        mocks.friendIdsOf.mockResolvedValue(new Set());
        mocks.presence.mockResolvedValue(new Map());
        mocks.getWorldByUrl.mockResolvedValue({ id: 'world' });
        mocks.ticket.mockResolvedValue({ token: 'ticket' });
        mocks.provision.mockResolvedValue(owner);
    });
    it('フレンド条件を満たさない参加者にはチケットを発行しない', async () => {
        await expect(instanceManager.join('room', { id: 'stranger', name: 'Stranger' })).rejects.toThrow(
            InstanceJoinRejected,
        );
        expect(mocks.ticket).not.toHaveBeenCalled();
        expect(mocks.provision).not.toHaveBeenCalled();
    });
    it('フレンド+はGoが返した現在の参加者を使って判定する', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'friend_plus' });
        mocks.friendIdsOf.mockResolvedValue(new Set(['friend']));
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['friend'] }]]));
        await expect(instanceManager.join('room', { id: 'visitor', name: 'Visitor' })).resolves.toEqual({
            token: 'ticket',
        });
        // チケットは割り当てた owner の Pod へ、その世代で発行する
        expect(mocks.ticket).toHaveBeenCalledWith('room', 'visitor', 'Visitor', owner, { leader: false });
    });
    it('招待のみ: 作成者のフレンドでも招待が無ければ入れず、招待が要ると伝える', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'invite_only' });
        mocks.friendIdsOf.mockResolvedValue(new Set(['owner']));
        await expect(instanceManager.join('room', { id: 'friend', name: 'Friend' })).rejects.toThrow(
            'このインスタンスに入るには招待が要ります',
        );
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
    it('招待のみ: フレンドでない人には、部屋があることも伝えない', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'invite_only' });
        await expect(instanceManager.join('room', { id: 'stranger', name: 'S' })).rejects.toThrow(
            'このインスタンスには入れません',
        );
        await expect(instanceManager.getInstanceFor('room', 'stranger')).resolves.toBeUndefined();
    });
    it('招待された人は、期限内なら公開範囲にかかわらず入れる', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'invite_only' });
        mocks.findValidInvite.mockResolvedValue({ id: 'inv' });
        await expect(instanceManager.join('room', { id: 'guest', name: 'Guest' })).resolves.toEqual({
            token: 'ticket',
        });
        expect(mocks.findValidInvite).toHaveBeenCalledWith('room', 'guest');
    });
    it('満員（定員ちょうど）なら、入れる人でも満員と伝えてチケットを出さない', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'public', maxUsers: 2 });
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['a', 'b'] }]]));
        await expect(instanceManager.join('room', { id: 'visitor', name: 'V' })).rejects.toThrow('満員です');
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
    it('招待されていても、満員なら入れない（招待のあとで満員になった）', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'invite_only', maxUsers: 2 });
        mocks.findValidInvite.mockResolvedValue({ id: 'inv' });
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['a', 'b'] }]]));
        await expect(instanceManager.join('room', { id: 'guest', name: 'G' })).rejects.toThrow('満員です');
    });
    it('作成者は満員でも入れ、そのときだけチケットに作成者の印を付ける（Go が定員を 1 人超えて通す）', async () => {
        mocks.findById.mockResolvedValue({ ...record, maxUsers: 2 });
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['a', 'b'] }]]));
        await expect(instanceManager.join('room', { id: 'owner', name: 'Owner' })).resolves.toEqual({
            token: 'ticket',
        });
        expect(mocks.ticket).toHaveBeenCalledWith('room', 'owner', 'Owner', owner, { leader: true });
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['a'] }]]));
        await instanceManager.join('room', { id: 'owner', name: 'Owner' });
        expect(mocks.ticket).toHaveBeenLastCalledWith('room', 'owner', 'Owner', owner, { leader: false });
    });
    it('中にいる人の入り直しは満員でも通す', async () => {
        mocks.findById.mockResolvedValue({ ...record, accessType: 'public', maxUsers: 2 });
        mocks.presence.mockResolvedValue(new Map([['room', { memberIds: ['a', 'b'] }]]));
        await expect(instanceManager.join('room', { id: 'a', name: 'A' })).resolves.toEqual({ token: 'ticket' });
    });
    it('Goに接続できない場合に公開範囲を迂回しない', async () => {
        mocks.presence.mockRejectedValue(new Error('runtime unavailable'));
        const error = await instanceManager.join('room', { id: 'owner', name: 'Owner' }).catch((e: unknown) => e);
        expect(error).not.toBeInstanceOf(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
    it('存在しないインスタンスは拒否として扱う', async () => {
        mocks.findById.mockResolvedValue(undefined);
        await expect(instanceManager.join('gone', { id: 'owner', name: 'Owner' })).rejects.toThrow(
            InstanceJoinRejected,
        );
    });
    it('ワールドが解決できなければ参加チケットを発行しない（取得元の障害かもしれないので拒否扱いにしない）', async () => {
        mocks.getWorldByUrl.mockResolvedValue(null);
        const error = await instanceManager.join('room', { id: 'owner', name: 'Owner' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(InstanceJoinRejected);
        expect(mocks.ticket).not.toHaveBeenCalled();
    });
});

describe('ticketName', () => {
    it('表示名をチケットに入れる（前後の空白は落とす）', () => {
        expect(ticketName(' アリス ')).toBe('アリス');
    });

    it('Go が受け付けない長さの名前は入れない（入室そのものは失敗させない）', () => {
        expect(ticketName('あ'.repeat(30))).toBe('あ'.repeat(30));
        expect(ticketName('あ'.repeat(31))).toBeUndefined();
        expect(ticketName('   ')).toBeUndefined();
        // 絵文字などサロゲートペアは 1 文字として数える（Go の rune 数と揃える）
        expect(ticketName('😀'.repeat(30))).toBe('😀'.repeat(30));
    });
});

describe('インスタンスの終了', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.findById.mockResolvedValue(record);
        mocks.deleteByLeader.mockResolvedValue(true);
    });

    it('Go 側で閉じられたと確かめてから DB を消す', async () => {
        mocks.close.mockResolvedValue(true);
        await expect(instanceManager.closeInstance('room', 'owner')).resolves.toEqual({ success: true });
        expect(mocks.deleteByLeader).toHaveBeenCalledWith('room', 'owner');
    });

    it('閉じられなければ（owner が止まっている・世代が合わない）DB を残して失敗を返す', async () => {
        mocks.close.mockResolvedValue(false);
        await expect(instanceManager.closeInstance('room', 'owner')).resolves.toMatchObject({
            success: false,
            reason: 'runtime-unavailable',
        });
        expect(mocks.deleteByLeader).not.toHaveBeenCalled();
    });

    it('Go への問い合わせが失敗したら DB を残す', async () => {
        mocks.close.mockRejectedValue(new Error('Instance runtime: 503'));
        await expect(instanceManager.closeInstance('room', 'owner')).rejects.toThrow();
        expect(mocks.deleteByLeader).not.toHaveBeenCalled();
    });

    it('リーダー以外は Go に問い合わせる前に拒否する', async () => {
        await expect(instanceManager.closeInstance('room', 'someone')).resolves.toMatchObject({ reason: 'forbidden' });
        expect(mocks.close).not.toHaveBeenCalled();
    });
});
