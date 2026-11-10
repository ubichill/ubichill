import { describe, expect, it } from 'vitest';
import { friendsByRemoteRoom, rememberFriendLocations, viaOf } from './joinVia';

const at = (id: string, friends: string[]) => ({ instance: { id }, friends: friends.map((f) => ({ id: f })) });

describe('会いに行くフレンド', () => {
    it('ほかのサーバーの部屋だけ、そこにいるフレンドを 10 人まで覚える', () => {
        const many = Array.from({ length: 12 }, (_, i) => `https://b.example/ap/users/${i}`);
        const byRoom = friendsByRemoteRoom([at('local1', ['u1']), at('r1@b.example', many), at('r2@c.example', [])]);
        expect([...byRoom.keys()]).toEqual(['r1@b.example']);
        expect(byRoom.get('r1@b.example')).toEqual(many.slice(0, 10));
    });

    it('読み直したら置き換え、いなくなった部屋のフレンドは渡さない', () => {
        rememberFriendLocations([at('r1@b.example', ['dave'])]);
        expect(viaOf('r1@b.example')).toEqual(['dave']);
        rememberFriendLocations([at('r2@b.example', ['erin'])]);
        expect(viaOf('r1@b.example')).toEqual([]);
        expect(viaOf('r2@b.example')).toEqual(['erin']);
    });
});
