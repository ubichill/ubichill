import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ API_BASE: '' }));

import { declinedEntryExit, isJoinRejection, presenceToInstance } from './instanceConnection';

describe('isJoinRejection', () => {
    it.each([401, 403, 404, 410, 422])('%i は再試行しても変わらない拒否', (status) => {
        expect(isJoinRejection(status)).toBe(true);
    });
    it.each([408, 429, 500, 502, 503, 504])('%i は一時的な失敗として再接続に任せる', (status) => {
        expect(isJoinRejection(status)).toBe(false);
    });
    it('成功やリダイレクトを拒否と誤認しない', () => {
        expect(isJoinRejection(200)).toBe(false);
        expect(isJoinRejection(302)).toBe(false);
    });
});

describe('presenceToInstance', () => {
    const presence = { id: 'standalone', name: 'Room', maxUsers: 8, memberIds: ['a', 'b'], emptySince: 0 };

    it('接続先は与えたサーバーの ws になる（相対パスにしない）', () => {
        expect(presenceToInstance(presence, 'https://go.example').connection.url).toBe(
            'https://go.example/realtime/v1/ws',
        );
    });
    it('在室人数は memberIds の数で、ゲストモードで空なら 0', () => {
        expect(presenceToInstance(presence, 'https://go.example').stats).toEqual({ currentUsers: 2, maxUsers: 8 });
        expect(presenceToInstance({ ...presence, memberIds: [] }, 'https://go.example').stats.currentUsers).toBe(0);
    });
    it('作者情報が無いので、署名済みとして扱わない（identity を付けない）', () => {
        const { world } = presenceToInstance(presence, 'https://go.example');
        expect(world.authorId).toBe('');
        expect('identity' in world).toBe(false);
    });
});

describe('declinedEntryExit', () => {
    it('単体モードでは / に移動しない（同じインスタンスへ戻されて確認が出続けるため）', () => {
        expect(declinedEntryExit(true).kind).toBe('stay');
    });
    it('通常はロビーに戻る', () => {
        expect(declinedEntryExit(false)).toEqual({ kind: 'navigate', to: '/' });
    });
});
