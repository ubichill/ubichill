import { describe, expect, it } from 'vitest';
import { featuredServersFor } from './featuredServers';

describe('ログイン画面に出す並び', () => {
    it('使えるサーバーを限っていなければ、管理者が決めた順のまま', () => {
        expect(featuredServersFor(['b.example', 'a.example'], new Set())).toEqual(['b.example', 'a.example']);
    });

    it('限っているなら、その中のものだけ。1 つも残らなければ使えるサーバーを並べる（入口を空にしない）', () => {
        const allowed = new Set(['a.example', 'c.example']);
        expect(featuredServersFor(['b.example', 'a.example'], allowed)).toEqual(['a.example']);
        expect(featuredServersFor(['b.example'], allowed)).toEqual(['a.example', 'c.example']);
        expect(featuredServersFor([], allowed)).toEqual(['a.example', 'c.example']);
    });
});
