import { isBlockedBetween } from '@ubichill/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { userBlockRepository } from './userBlockRepository';
import { userRepository } from './userRepository';

/** ブロックの DB 統合テスト。DATABASE_URL がある時だけ走る。 */

const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `bl-a-${stamp}`, b: `bl-b-${stamp}`, c: `bl-c-${stamp}` };
const ACTOR = `https://c.example/ap/users/bl-${stamp}`;

describe.skipIf(!RUN)('userBlockRepository (DB統合)', () => {
    beforeAll(async () => {
        for (const [key, id] of Object.entries(ids)) {
            await userRepository.create({
                id,
                name: `block_${key}_${stamp}`,
                email: `${id}@example.com`,
                handle: `bl${key}${stamp}`.slice(0, 30),
            });
        }
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('ブロックは 1 行。ブロックし直しても増えず、向きを見て引ける', async () => {
        expect(await userBlockRepository.add(ids.a, ids.b)).toBe(true);
        expect(await userBlockRepository.add(ids.a, ids.b)).toBe(false);
        expect(await userBlockRepository.countForUser(ids.a)).toBe(1);
        expect(await userBlockRepository.countForUser(ids.b)).toBe(0);
        const edges = await userBlockRepository.findBetween(ids.b, ids.a);
        expect(edges).toEqual([{ blockerId: ids.a, blockedId: ids.b }]);
        expect(isBlockedBetween(edges, ids.b, ids.a)).toBe(true);
    });

    it('自分はブロックできない（DB の制約でも止める）', async () => {
        await expect(userBlockRepository.add(ids.c, ids.c)).rejects.toThrow();
    });

    it('ほかのサーバーの actor の URL もブロックでき、一覧に出る', async () => {
        expect(await userBlockRepository.add(ids.a, ACTOR)).toBe(true);
        await userBlockRepository.add(ids.c, ids.a);
        expect((await userBlockRepository.listForUser(ids.a)).map((r) => r.blockedId).sort()).toEqual(
            [ids.b, ACTOR].sort(),
        );
    });

    it('解除は自分の行だけ。相手からのブロックは残る', async () => {
        expect(await userBlockRepository.remove(ids.a, ids.c)).toBe(false);
        expect(await userBlockRepository.remove(ids.a, ids.b)).toBe(true);
        expect(await userBlockRepository.findBetween(ids.a, ids.c)).toEqual([{ blockerId: ids.c, blockedId: ids.a }]);
    });

    it('ブロックした人が消えたら行も消える', async () => {
        await userRepository.deleteById(ids.c);
        expect(await userBlockRepository.findBetween(ids.a, ids.c)).toEqual([]);
    });

    it('ブロックされた人が消えたら、ブロックした人の一覧からも消える（blocked_id には FK が無い）', async () => {
        await userBlockRepository.add(ids.a, ids.b);
        await userRepository.deleteById(ids.b);
        expect(await userBlockRepository.findBetween(ids.a, ids.b)).toEqual([]);
        expect((await userBlockRepository.listForUser(ids.a)).map((r) => r.blockedId)).toEqual([ACTOR]);
        expect(await userBlockRepository.countForUser(ids.a)).toBe(1);
    });
});
