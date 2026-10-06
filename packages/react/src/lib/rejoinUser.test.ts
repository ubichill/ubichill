import type { User } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { rejoinUser } from './rejoinUser';

const initial: Omit<User, 'id'> = { name: 'ようかん', status: 'online', position: { x: 0, y: 0 }, lastActiveAt: 1 };

describe('rejoinUser', () => {
    it('最初の参加は最初の値を送る', () => {
        expect(rejoinUser(initial, null, 100)).toBe(initial);
    });

    it('再接続では今の位置・ステータスを送り、初期値に戻さない', () => {
        const current: User = { ...initial, id: 'u1', status: 'busy', position: { x: 320, y: 48 }, lastActiveAt: 50 };
        expect(rejoinUser(initial, current, 100)).toEqual({
            name: 'ようかん',
            status: 'busy',
            position: { x: 320, y: 48 },
            lastActiveAt: 100,
        });
    });

    it('サーバーが決める id は送らない', () => {
        const current: User = { ...initial, id: 'u1' };
        expect(rejoinUser(initial, current, 100)).not.toHaveProperty('id');
    });
});
