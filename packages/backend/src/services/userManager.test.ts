import type { User } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { UserManager } from './userManager';

function makeUser(id: string): User {
    return { id, name: `u${id}`, status: 'online', position: { x: 0, y: 0 }, lastActiveAt: 0 };
}

describe('UserManager', () => {
    it('addUser / getUser / getUserWorld / removeUser が整合する', () => {
        const m = new UserManager();
        const u = makeUser('1');
        m.addUser('1', 'w1', u);
        expect(m.getUser('1')).toBe(u);
        expect(m.getUserWorld('1')).toBe('w1');

        expect(m.removeUser('1')).toBe(u);
        expect(m.getUser('1')).toBeUndefined();
        expect(m.getUserWorld('1')).toBeUndefined();
    });

    it('getUsersByWorld はワールド所属ユーザーだけを返す', () => {
        const m = new UserManager();
        m.addUser('1', 'w1', makeUser('1'));
        m.addUser('2', 'w1', makeUser('2'));
        m.addUser('3', 'w2', makeUser('3'));
        expect(m.getUsersByWorld('w1').map((u) => u.id)).toEqual(['1', '2']);
        expect(m.getUsersByWorld('w2').map((u) => u.id)).toEqual(['3']);
    });

    it('removeUser で空になったワールドは管理から消える', () => {
        const m = new UserManager();
        m.addUser('1', 'w1', makeUser('1'));
        m.removeUser('1');
        expect(m.getUsersByWorld('w1')).toEqual([]);
        expect(m.getWorldCount()).toBe(0);
    });

    it('updateUserPosition / updateUserStatus は未知ユーザーに false を返す', () => {
        const m = new UserManager();
        expect(m.updateUserPosition('nope', { x: 1, y: 2 })).toBe(false);
        expect(m.updateUserStatus('nope', 'away')).toBe(false);
    });

    it('updateUserPosition / updateUserStatus は既知ユーザーを更新する', () => {
        const m = new UserManager();
        m.addUser('1', 'w1', makeUser('1'));
        expect(m.updateUserPosition('1', { x: 5, y: 6 })).toBe(true);
        expect(m.getUser('1')?.position).toEqual({ x: 5, y: 6 });
        expect(m.updateUserStatus('1', 'busy')).toBe(true);
        expect(m.getUser('1')?.status).toBe('busy');
    });

    it('updateUser は penColor / heldEntityId のみ許可し、他フィールドは無視する', () => {
        const m = new UserManager();
        m.addUser('1', 'w1', makeUser('1'));
        const updated = m.updateUser('1', { penColor: '#fff', heldEntityId: 'e1', name: 'HACKED' });
        expect(updated?.penColor).toBe('#fff');
        expect(updated?.heldEntityId).toBe('e1');
        expect(updated?.name).toBe('u1'); // name はホワイトリスト外
    });

    it('updateUser は null で penColor / heldEntityId を解除できる', () => {
        const m = new UserManager();
        const u = { ...makeUser('1'), penColor: '#000', heldEntityId: 'e1' };
        m.addUser('1', 'w1', u);
        m.updateUser('1', { penColor: null, heldEntityId: null });
        expect(m.getUser('1')?.penColor).toBeNull();
        expect(m.getUser('1')?.heldEntityId).toBeNull();
    });

    it('getUserCount は総ユーザー数を返す', () => {
        const m = new UserManager();
        m.addUser('1', 'w1', makeUser('1'));
        m.addUser('2', 'w2', makeUser('2'));
        expect(m.getUserCount()).toBe(2);
    });
});
