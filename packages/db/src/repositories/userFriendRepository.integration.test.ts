import { displayNameKey, friendshipOf, parseUserSearchQuery } from '@ubichill/shared';
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

    /** 画面と同じ規則で検索語を解釈して検索する（ID・表示名の検索だけを対象にする）。 */
    const search = (text: string, options: Parameters<typeof userRepository.search>[1]) => {
        const query = parseUserSearchQuery(text, 'test.invalid');
        if (query.kind !== 'text') throw new Error(`検索語 ${text} が ${query.kind} になった`);
        return userRepository.search(query, options);
    };

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

    it('相手から申請が来ていれば、申請は承認になる', async () => {
        expect(friendshipOf(await userFriendRepository.requestOrAccept(ids.a, ids.b), ids.a, ids.b)).toBe('outgoing');
        expect(friendshipOf(await userFriendRepository.requestOrAccept(ids.a, ids.b), ids.a, ids.b)).toBe('outgoing');
        expect(friendshipOf(await userFriendRepository.requestOrAccept(ids.b, ids.a), ids.b, ids.a)).toBe('friends');
        expect(await userFriendRepository.findBetween(ids.a, ids.b)).toHaveLength(1);
        await userFriendRepository.remove(ids.a, ids.b);
    });

    it('同時に申請し合ってもフレンドになる（どちらも「申請が来ている」のままにならない）', async () => {
        for (const _round of Array.from({ length: 10 })) {
            await Promise.all([
                userFriendRepository.requestOrAccept(ids.a, ids.b),
                userFriendRepository.requestOrAccept(ids.b, ids.a),
            ]);
            expect(await relation(ids.a, ids.b)).toBe('friends');
            expect(await userFriendRepository.findBetween(ids.a, ids.b)).toHaveLength(1);
            await userFriendRepository.remove(ids.a, ids.b);
        }
    });

    it('検索: 表示名の部分一致（大文字小文字は区別しない）と ID の前方一致', async () => {
        expect((await search(`charlie_${stamp}`, { limit: 5 })).map((u) => u.id)).toEqual([ids.c]);
        expect((await search(`ch${stamp}`.slice(0, 6), { limit: 50 })).map((u) => u.id)).toContain(ids.c);
        expect((await search(`いう_${stamp}`, { limit: 5 })).map((u) => u.id)).toEqual([ids.a]);
    });

    it('検索語の % と _ は文字として扱う（全件に当たらない）', async () => {
        expect((await search(`100%_${stamp}`, { limit: 5 })).map((u) => u.id)).toEqual([ids.b]);
        const percent = await search('%', { limit: 1000 });
        expect(percent.map((u) => u.id)).toContain(ids.b);
        expect(percent.every((u) => u.name.includes('%') || u.handle?.startsWith('%'))).toBe(true);
    });

    it('除外した ID は出さない', async () => {
        expect(await search(`charlie_${stamp}`, { limit: 5, excludeIds: [ids.c] })).toEqual([]);
    });

    it('一意キーで照合するので、全角で打っても見つかる', async () => {
        await userRepository.setDisplayName(ids.c, `Charlie_${stamp}`, displayNameKey(`Charlie_${stamp}`));
        const fullWidth = `ＣＨＡＲＬＩＥ_${stamp}`;
        expect((await search(fullWidth, { limit: 5 })).map((u) => u.id)).toEqual([ids.c]);
    });

    it('ID の前方一致が表示名の部分一致より先に並ぶ', async () => {
        // a の表示名に c の ID を含めても、ID が一致する c が先
        const handle = `ch${stamp}`.slice(0, 30);
        await userRepository.setDisplayName(ids.a, `x${handle}`, displayNameKey(`x${handle}`));
        expect((await search(handle, { limit: 5 })).map((u) => u.id)).toEqual([ids.c, ids.a]);
    });
});

describe.skipIf(!RUN)('userRepository.setDisplayName の変更制限 (DB統合)', () => {
    const id = `dn-${stamp}`;
    const t0 = new Date('2026-01-01T00:00:00Z');

    beforeAll(async () => {
        await userRepository.create({ id, name: `dn_${stamp}`, email: `${id}@example.com` });
    });
    afterAll(async () => {
        await userRepository.deleteById(id);
    });

    it('最後の変更が基準より後なら書き込まない（期間中の同時リクエストで 2 回変えられない）', async () => {
        const first = await userRepository.setDisplayName(id, `dn1_${stamp}`, `dn1_${stamp}`, {
            changedAt: t0,
            notChangedAfter: new Date(t0.getTime() - 1),
        });
        expect(first?.displayNameChangedAt).toEqual(t0);
        // 同じ基準で 2 回目: 1 回目の changedAt が基準より後なので書き込まれない
        const second = await userRepository.setDisplayName(id, `dn2_${stamp}`, `dn2_${stamp}`, {
            changedAt: t0,
            notChangedAfter: new Date(t0.getTime() - 1),
        });
        expect(second).toBeUndefined();
        expect((await userRepository.findById(id))?.name).toBe(`dn1_${stamp}`);
    });

    it('changedAt を渡さない変更（見た目だけ）は時刻を進めない', async () => {
        const updated = await userRepository.setDisplayName(id, `DN1_${stamp}`, `dn1_${stamp}`);
        expect(updated?.displayNameChangedAt).toEqual(t0);
    });
});
