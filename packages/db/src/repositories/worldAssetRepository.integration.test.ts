import { createHash } from 'node:crypto';
import { type WorldSignature, worldAssetPath } from '@ubichill/shared';
import { and, eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { users, worldAssets } from '../schema';
import { userRepository } from './userRepository';
import { worldAssetRepository } from './worldAssetRepository';
import { worldRepository } from './worldRepository';

/** ワールドの画像の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const alice = `wa-${stamp}-alice`;
const bob = `wa-${stamp}-bob`;

const image = (hash: string, size = 10) => ({ hash, bytes: new Uint8Array(size).fill(7), width: 4, height: 3 });

describe.skipIf(!RUN)('worldAssetRepository (DB統合)', () => {
    beforeAll(async () => {
        for (const [id, handle] of [
            [alice, `wa_${stamp}_a`],
            [bob, `wa_${stamp}_b`],
        ]) {
            await userRepository.create({ id, name: id, email: `${id}@example.com`, handle, emailVerified: true });
        }
    });
    afterAll(async () => {
        // 持ち主を消すと画像も消える（cascade）
        await db.delete(users).where(like(users.id, `wa-${stamp}%`));
    });

    it('足す・同じ画像は数えない・中身はハッシュで引ける', async () => {
        const quota = { count: 5, bytes: 1000 };
        expect(await worldAssetRepository.add(alice, image(`${stamp}-1`), quota)).toBe('added');
        expect(await worldAssetRepository.add(alice, image(`${stamp}-1`), quota)).toBe('exists');
        expect(await worldAssetRepository.add(bob, image(`${stamp}-1`), quota)).toBe('added');
        expect(await worldAssetRepository.findByHash(`${stamp}-1`)).toMatchObject({ width: 4, height: 3 });
        expect((await worldAssetRepository.findByHash(`${stamp}-1`))?.bytes).toEqual(new Uint8Array(10).fill(7));
        expect(await worldAssetRepository.listByOwner(alice)).toHaveLength(1);
    });

    it('同時に上げても上限を越えない', async () => {
        const quota = { count: 3, bytes: 10_000 };
        const outcomes = await Promise.all(
            Array.from({ length: 6 }, (_, n) => worldAssetRepository.add(bob, image(`${stamp}-c${n}`), quota)),
        );
        // bob は前の試験で 1 枚持っているので、足せるのは 2 枚
        expect(outcomes.filter((o) => o === 'added')).toHaveLength(2);
        expect(outcomes.filter((o) => o === 'over-quota')).toHaveLength(4);
        expect(await worldAssetRepository.add(bob, image(`${stamp}-big`, 20_000), { count: 100, bytes: 10_000 })).toBe(
            'over-quota',
        );
    });

    it('消せるのは自分の分だけで、ほかの人が上げた同じ画像は残る', async () => {
        expect(await worldAssetRepository.remove(alice, `${stamp}-1`)).toBe(true);
        expect(await worldAssetRepository.remove(alice, `${stamp}-1`)).toBe(false);
        expect(await worldAssetRepository.findByHash(`${stamp}-1`)).toBeDefined();
    });

    describe('removeUnreferenced', () => {
        // ほかの試験の画像（今の時刻）に触れないよう、ずっと前の時刻で試す
        const cutoff = new Date('2001-01-02T00:00:00Z');
        const old = new Date('2001-01-01T00:00:00Z');
        const quota = { count: 100, bytes: 100_000 };
        const hashOf = (label: string) => createHash('sha256').update(`${stamp}:${label}`).digest('base64url');
        const url = (label: string) => `https://ubi.example${worldAssetPath(hashOf(label))}`;
        const draft = (definition: unknown) => ({ definition, lock: null, unpublish: false });
        const publishInput = (definition: unknown, version = '1.0.0') => ({
            version,
            definition,
            lock: null,
            signature: {} as WorldSignature,
            contentHash: `${stamp}-${version}-${JSON.stringify(definition).length}`,
        });
        const upload = async (ownerId: string, label: string, createdAt: Date) => {
            expect(await worldAssetRepository.add(ownerId, image(hashOf(label)), quota)).toBe('added');
            await db
                .update(worldAssets)
                .set({ createdAt })
                .where(and(eq(worldAssets.ownerId, ownerId), eq(worldAssets.hash, hashOf(label))));
        };
        /** `持ち主:ラベル`。ほかの回の残り（ラベルの無い行）は除く */
        const named = (labels: string[], rows: Array<{ ownerId: string; hash: string }>) =>
            rows
                .flatMap((row) => {
                    const label = labels.find((l) => hashOf(l) === row.hash);
                    return label ? [`${row.ownerId === alice ? 'alice' : 'bob'}:${label}`] : [];
                })
                .sort();
        const remaining = async (labels: string[]) =>
            named(
                labels,
                await db
                    .select({ ownerId: worldAssets.ownerId, hash: worldAssets.hash })
                    .from(worldAssets)
                    .where(inArray(worldAssets.hash, labels.map(hashOf))),
            );
        const sweepAll = async (labels: string[]) =>
            named(labels, await worldAssetRepository.removeUnreferenced(cutoff, 1000));

        it('どのワールドにも使われず猶予を過ぎた画像だけを消す。使っているのがほかの人のワールドでも、版だけでも残す', async () => {
            const labels = [
                'in-draft',
                'in-version',
                'in-bobs-world',
                'encoded',
                'at-cutoff',
                'fresh',
                'orphan',
                'text-only',
            ];
            for (const label of labels) {
                await upload(
                    alice,
                    label,
                    label === 'at-cutoff' ? cutoff : label === 'fresh' ? new Date(cutoff.getTime() + 1) : old,
                );
            }
            await upload(bob, 'orphan', old);
            await worldRepository.saveDraft(
                { authorId: alice, worldName: `sweep-draft-${stamp}` },
                draft({ entities: [{ components: [{ type: 'core:image', data: { src: url('in-draft') } }] }] }),
            );
            await worldRepository.publish(
                { authorId: alice, worldName: `sweep-version-${stamp}` },
                publishInput({ spec: { thumbnail: url('in-version') } }),
            );
            // 複製したワールド: bob のワールドが alice の上げた画像を指す
            await worldRepository.saveDraft(
                { authorId: bob, worldName: `sweep-copy-${stamp}` },
                draft({
                    spec: {
                        environment: { backgroundImage: url('in-bobs-world') },
                        links: [`https://proxy.example/?u=${encodeURIComponent(url('encoded'))}`],
                    },
                    // .webp の付かないハッシュは画像を指していない
                    notes: `${hashOf('text-only')} を後で使う`,
                }),
            );

            const removed = await sweepAll(labels);
            expect(removed).toEqual(['alice:orphan', 'alice:text-only', 'bob:orphan']);
            expect(await remaining(labels)).toEqual(
                ['in-draft', 'in-version', 'in-bobs-world', 'encoded', 'at-cutoff', 'fresh']
                    .map((l) => `alice:${l}`)
                    .sort(),
            );
            expect(await worldAssetRepository.findByHash(hashOf('orphan'))).toBeUndefined();
        });

        it('上げ直した画像は猶予を数え直す。ワールドを消すと、次の掃除で消える', async () => {
            const labels = ['reuploaded', 'deleted-world'];
            await upload(alice, 'reuploaded', old);
            await upload(alice, 'deleted-world', old);
            expect(await worldAssetRepository.add(alice, image(hashOf('reuploaded')), quota)).toBe('exists');
            const saved = await worldRepository.saveDraft(
                { authorId: alice, worldName: `sweep-gone-${stamp}` },
                draft({ spec: { thumbnail: url('deleted-world') } }),
            );
            expect(await sweepAll(labels)).toEqual([]);

            if (saved.status !== 'draft') throw new Error('下書きを保存できませんでした');
            expect(await worldRepository.delete(saved.worldId)).toBe(true);
            expect(await sweepAll(labels)).toEqual(['alice:deleted-world']);
            expect(await remaining(labels)).toEqual(['alice:reuploaded']);
        });

        it('1 回に消すのは limit 枚まで。残りは次の回に消す', async () => {
            const labels = ['batch-1', 'batch-2', 'batch-3'];
            for (const label of labels) await upload(bob, label, old);
            const first = await worldAssetRepository.removeUnreferenced(cutoff, 2);
            expect(first).toHaveLength(2);
            expect(first[0]).toMatchObject({ byteSize: 10 });
            await sweepAll(labels);
            expect(await remaining(labels)).toEqual([]);
            expect(await worldAssetRepository.removeUnreferenced(cutoff, 2)).toEqual([]);
        });
    });
});
