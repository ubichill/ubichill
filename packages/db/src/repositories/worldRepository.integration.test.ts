import type { WorldSignature } from '@ubichill/shared';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { users, worlds } from '../schema';
import { worldRepository } from './worldRepository';

/** ワールドの一覧・作成の上限の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const authorIds = ['list', 'race', 'same', 'update'].map((label) => `it-wr-${label}-${stamp}`);
const [LIST, RACE, SAME, UPDATE] = authorIds as [string, string, string, string];

const draft = { definition: { metadata: { name: 'x', version: '1.0.0' } }, lock: null, unpublish: true };
const publishInput = (contentHash: string) => ({
    version: '1.0.0',
    definition: { metadata: { version: '1.0.0' } },
    lock: null,
    signature: {} as WorldSignature,
    contentHash,
});

describe.skipIf(!RUN)('worldRepository (DB統合)', () => {
    beforeAll(async () => {
        await db
            .insert(users)
            .values(authorIds.map((id) => ({ id, name: id, email: `${id}@example.com`, handle: id.slice(-30) })));
    });
    afterAll(async () => {
        await db.delete(users).where(inArray(users.id, authorIds));
    });

    it('一覧は公開中の版があるワールドだけを、更新の新しい順に上限まで返す', async () => {
        await worldRepository.saveDraft({ authorId: LIST, worldName: 'draft-only' }, draft);
        await worldRepository.publish({ authorId: LIST, worldName: 'older' }, publishInput(`older-${stamp}`));
        await worldRepository.publish({ authorId: LIST, worldName: 'newer' }, publishInput(`newer-${stamp}`));
        const mine = (rows: Awaited<ReturnType<typeof worldRepository.findPublished>>) =>
            rows.filter((r) => r.authorId === LIST).map((r) => r.worldName);
        expect(mine(await worldRepository.findPublished(1000))).toEqual(['newer', 'older']);
        expect(await worldRepository.findPublished(1)).toHaveLength(1);
        expect(await worldRepository.findPublished(0)).toEqual([]);
    });

    it('公開範囲は既定でパブリック。作者だけが変えられる', async () => {
        const saved = await worldRepository.publish(
            { authorId: LIST, worldName: 'visibility' },
            publishInput(`visibility-${stamp}`),
        );
        if (saved.status !== 'published') throw new Error(saved.status);
        expect((await worldRepository.findById(saved.worldId))?.visibility).toBe('public');
        expect(await worldRepository.setVisibility(saved.worldId, SAME, 'private')).toBe(false);
        expect((await worldRepository.findById(saved.worldId))?.visibility).toBe('public');
        expect(await worldRepository.setVisibility(saved.worldId, LIST, 'private')).toBe(true);
        expect((await worldRepository.findState(saved.worldId))?.world.visibility).toBe('private');
        expect(await worldRepository.setVisibility('missing-world', LIST, 'public')).toBe(false);
    });

    it('違う名前の作成を同時に送っても、作者ごとの上限を超えない（公開・下書きのどちらでも）', async () => {
        const results = await Promise.all(
            Array.from({ length: 8 }, (_, i) =>
                i % 2 === 0
                    ? worldRepository.saveDraft({ authorId: RACE, worldName: `race-${i}`, maxWorlds: 5 }, draft)
                    : worldRepository.publish(
                          { authorId: RACE, worldName: `race-${i}`, maxWorlds: 5 },
                          publishInput(`race-${i}-${stamp}`),
                      ),
            ),
        );
        expect(results.filter((r) => r.status === 'limit')).toHaveLength(3);
        expect(await worldRepository.countByAuthorId(RACE)).toBe(5);
    });

    it('上限ちょうどでも、同じ名前の作成が重なったら一意制約で知らせる（呼び出し側は更新として送り直す）', async () => {
        for (const i of [0, 1, 2, 3]) {
            await worldRepository.saveDraft({ authorId: SAME, worldName: `pre-${i}`, maxWorlds: 5 }, draft);
        }
        const results = await Promise.allSettled([
            worldRepository.saveDraft({ authorId: SAME, worldName: 'twin', maxWorlds: 5 }, draft),
            worldRepository.saveDraft({ authorId: SAME, worldName: 'twin', maxWorlds: 5 }, draft),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected');
        // drizzle は postgres のエラーを cause に包む（backend の isUniqueViolation と同じく両方を見る）
        const reason =
            rejected?.status === 'rejected'
                ? (rejected.reason as { code?: string; cause?: { code?: string } })
                : undefined;
        expect(reason?.code ?? reason?.cause?.code).toBe('23505');
        expect(await worldRepository.countByAuthorId(SAME)).toBe(5);
    });

    it('上限に達していても、今あるワールドの更新・名前の変更はできる', async () => {
        const ids = [];
        for (const i of [0, 1]) {
            const saved = await worldRepository.saveDraft(
                { authorId: UPDATE, worldName: `w-${i}`, maxWorlds: 2 },
                draft,
            );
            if (saved.status === 'draft') ids.push(saved.worldId);
        }
        expect(
            (await worldRepository.saveDraft({ authorId: UPDATE, worldName: 'w-new', maxWorlds: 2 }, draft)).status,
        ).toBe('limit');
        const renamed = await worldRepository.publish(
            { authorId: UPDATE, worldName: 'renamed', worldId: ids[0], maxWorlds: 2 },
            publishInput(`renamed-${stamp}`),
        );
        expect(renamed.status).toBe('published');
        const [row] = await db
            .select()
            .from(worlds)
            .where(eq(worlds.id, ids[0] as string));
        expect(row?.worldName).toBe('renamed');
    });
});
