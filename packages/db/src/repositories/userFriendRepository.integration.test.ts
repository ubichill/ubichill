import { friendshipOf } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userFriendRepository } from './userFriendRepository';
import { userRepository } from './userRepository';

/**
 * フレンドの申請・承認・解除とユーザー検索の DB 統合テスト。DATABASE_URL がある時だけ走る。
 */

const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `fr-a-${stamp}`, b: `fr-b-${stamp}`, c: `fr-c-${stamp}` };

describe.skipIf(!RUN)('userFriendRepository / userRepository.search (DB統合)', () => {
    beforeAll(async () => {
        await userRepository.create({ id: ids.a, name: `あいう_${stamp}`, email: `${ids.a}@example.com` });
        await userRepository.create({ id: ids.b, name: `b100%_${stamp}`, email: `${ids.b}@example.com` });
        await userRepository.create({ id: ids.c, name: `Charlie_${stamp}`, email: `${ids.c}@example.com` });
        await userRepository.setHandleOnce(ids.c, `ch${stamp}`.slice(0, 30));
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    const relation = async (me: string, other: string) =>
        friendshipOf(await userFriendRepository.findBetween(me, other), me, other);

    it('申請 → 承認でフレンド。二重の申請は増えない', async () => {
        await userFriendRepository.request(ids.a, ids.b);
        await userFriendRepository.request(ids.a, ids.b);
        expect(await userFriendRepository.findBetween(ids.a, ids.b)).toHaveLength(1);
        expect(await relation(ids.a, ids.b)).toBe('outgoing');
        expect(await relation(ids.b, ids.a)).toBe('incoming');

        // 申請した側は承認できない（向きを見る）
        expect(await userFriendRepository.accept(ids.a, ids.b)).toBe(false);
        expect(await userFriendRepository.accept(ids.b, ids.a)).toBe(true);
        expect(await userFriendRepository.areFriends(ids.a, ids.b)).toBe(true);
    });

    it('解除はどちらからでもでき、2 人の関係がすべて消える', async () => {
        expect(await userFriendRepository.remove(ids.b, ids.a)).toBe(true);
        expect(await userFriendRepository.findBetween(ids.a, ids.b)).toHaveLength(0);
        expect(await userFriendRepository.remove(ids.b, ids.a)).toBe(false);
    });

    it('検索: 表示名の部分一致（大文字小文字は区別しない）と ID の前方一致', async () => {
        expect((await userRepository.search(`charlie_${stamp}`, { limit: 5 })).map((u) => u.id)).toEqual([ids.c]);
        expect((await userRepository.search(`ch${stamp}`.slice(0, 6), { limit: 50 })).map((u) => u.id)).toContain(
            ids.c,
        );
        expect((await userRepository.search(`いう_${stamp}`, { limit: 5 })).map((u) => u.id)).toEqual([ids.a]);
    });

    it('検索語の % と _ は文字として扱う（全件に当たらない）', async () => {
        expect((await userRepository.search(`100%_${stamp}`, { limit: 5 })).map((u) => u.id)).toEqual([ids.b]);
        const percent = await userRepository.search('%', { limit: 1000 });
        expect(percent.map((u) => u.id)).toContain(ids.b);
        expect(percent.every((u) => u.name.includes('%') || u.handle?.startsWith('%'))).toBe(true);
    });

    it('除外した ID は出さない', async () => {
        expect(await userRepository.search(`charlie_${stamp}`, { limit: 5, excludeIds: [ids.c] })).toEqual([]);
    });
});
