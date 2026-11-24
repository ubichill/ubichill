import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { modFavoriteRepository } from './modFavoriteRepository';
import { userRepository } from './userRepository';

/** お気に入りの mod の DB 統合テスト。DATABASE_URL がある時だけ走る。 */

const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const ids = { a: `mf-a-${stamp}`, b: `mf-b-${stamp}`, gone: `mf-g-${stamp}` };
const ref = (id: string, author = 'alice@example.com') => ({ author, id });

describe.skipIf(!RUN)('modFavoriteRepository (DB統合)', () => {
    beforeAll(async () => {
        for (const [key, id] of Object.entries(ids))
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle: `mf${key}${stamp}` });
    });

    afterAll(async () => {
        for (const id of Object.values(ids)) await userRepository.deleteById(id);
    });

    it('足すと新しい順に並び、同じ mod は 2 回目を数えない', async () => {
        expect(await modFavoriteRepository.addWithinLimit(ids.a, ref('pen'), 10)).toBe('added');
        await new Promise((r) => setTimeout(r, 5));
        expect(await modFavoriteRepository.addWithinLimit(ids.a, ref('danmaku'), 10)).toBe('added');
        expect(await modFavoriteRepository.addWithinLimit(ids.a, ref('pen'), 10)).toBe('exists');
        expect(await modFavoriteRepository.list(ids.a)).toEqual([ref('danmaku'), ref('pen')]);
    });

    it('作者が違えば同じ ID でも別の mod', async () => {
        expect(await modFavoriteRepository.addWithinLimit(ids.a, ref('pen', 'bob@other.example'), 10)).toBe('added');
        expect(await modFavoriteRepository.list(ids.a)).toContainEqual(ref('pen', 'bob@other.example'));
        await modFavoriteRepository.remove(ids.a, ref('pen', 'bob@other.example'));
        expect(await modFavoriteRepository.list(ids.a)).toContainEqual(ref('pen'));
    });

    it('上限に達したら足さない。もうあるものは上限でも exists', async () => {
        await modFavoriteRepository.addWithinLimit(ids.b, ref('one'), 2);
        await modFavoriteRepository.addWithinLimit(ids.b, ref('two'), 2);
        expect(await modFavoriteRepository.addWithinLimit(ids.b, ref('three'), 2)).toBe('limit');
        expect(await modFavoriteRepository.addWithinLimit(ids.b, ref('one'), 2)).toBe('exists');
        expect(await modFavoriteRepository.list(ids.b)).toHaveLength(2);
    });

    it('同時に足しても上限を超えない', async () => {
        await modFavoriteRepository.remove(ids.b, ref('one'));
        await modFavoriteRepository.remove(ids.b, ref('two'));
        const outcomes = await Promise.all(
            ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => modFavoriteRepository.addWithinLimit(ids.b, ref(id), 3)),
        );
        expect(outcomes.filter((o) => o === 'added')).toHaveLength(3);
        expect(outcomes.filter((o) => o === 'limit')).toHaveLength(3);
        expect(await modFavoriteRepository.list(ids.b)).toHaveLength(3);
    });

    it('外すのはその人のその mod だけ。無いものを外しても失敗しない', async () => {
        await modFavoriteRepository.addWithinLimit(ids.b, ref('pen'), 10);
        await modFavoriteRepository.remove(ids.a, ref('pen'));
        await modFavoriteRepository.remove(ids.a, ref('never-added'));
        expect(await modFavoriteRepository.list(ids.a)).not.toContainEqual(ref('pen'));
        expect(await modFavoriteRepository.list(ids.b)).toContainEqual(ref('pen'));
    });

    it('ユーザーを消すとお気に入りも消える', async () => {
        await modFavoriteRepository.addWithinLimit(ids.gone, ref('pen'), 10);
        await userRepository.deleteById(ids.gone);
        expect(await modFavoriteRepository.list(ids.gone)).toEqual([]);
    });
});
