import { createHash } from 'node:crypto';
import { type WorldSignature, worldAssetPath } from '@ubichill/shared';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../index';
import { users, worldAssets, worldDrafts, worlds } from '../schema';
import { userRepository } from './userRepository';
import { userSettingsRepository } from './userSettingsRepository';
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
        const quota = 1000;
        expect(await worldAssetRepository.add(alice, image(`${stamp}-1`), quota)).toEqual({ status: 'added' });
        expect(await worldAssetRepository.add(alice, image(`${stamp}-1`), quota)).toEqual({ status: 'exists' });
        expect(await worldAssetRepository.add(bob, image(`${stamp}-1`), quota)).toEqual({ status: 'added' });
        expect(await worldAssetRepository.findByHash(`${stamp}-1`)).toMatchObject({ width: 4, height: 3 });
        expect((await worldAssetRepository.findByHash(`${stamp}-1`))?.bytes).toEqual(new Uint8Array(10).fill(7));
        expect(await worldAssetRepository.listByOwner(alice)).toHaveLength(1);
    });

    it('同時に上げても合計の上限を越えない。越えるときは今の合計を返す', async () => {
        // bob は前の試験で 10 バイト持っているので、10 バイトの画像を足せるのは 2 枚
        const outcomes = await Promise.all(
            Array.from({ length: 6 }, (_, n) => worldAssetRepository.add(bob, image(`${stamp}-c${n}`), 30)),
        );
        expect(outcomes.filter((o) => o.status === 'added')).toHaveLength(2);
        expect(outcomes.filter((o) => o.status === 'over-quota')).toHaveLength(4);
        expect(await worldAssetRepository.add(bob, image(`${stamp}-big`, 20_000), 10_000)).toEqual({
            status: 'over-quota',
            usedBytes: 30,
        });
        // ちょうど上限までは置ける
        expect(await worldAssetRepository.add(bob, image(`${stamp}-edge`, 5), 35)).toEqual({ status: 'added' });
    });

    it('数は数えない（小さい画像なら 200 枚を越えて置ける）', async () => {
        const many = Array.from({ length: 201 }, (_, n) => image(`${stamp}-many-${n}`, 1));
        for (const one of many) {
            expect((await worldAssetRepository.add(alice, one, 1000)).status).toBe('added');
        }
        expect(await worldAssetRepository.listByOwner(alice)).toHaveLength(202);
        await db.delete(worldAssets).where(like(worldAssets.hash, `${stamp}-many-%`));
    });

    it('サーバー全体の合計', async () => {
        const before = await worldAssetRepository.totalBytes();
        await worldAssetRepository.add(alice, image(`${stamp}-total`, 123), 100_000);
        expect((await worldAssetRepository.totalBytes()) - before).toBe(123);
        await worldAssetRepository.remove(alice, `${stamp}-total`);
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
        const quota = 100_000;
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
            expect(await worldAssetRepository.add(ownerId, image(hashOf(label)), quota)).toEqual({ status: 'added' });
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
            expect(await worldAssetRepository.add(alice, image(hashOf('reuploaded')), quota)).toEqual({
                status: 'exists',
            });
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

        describe('定義の保存と重なったとき', () => {
            const deferred = () => {
                const d = { resolve: () => {} };
                const promise = new Promise<void>((resolve) => {
                    d.resolve = resolve;
                });
                return { promise, resolve: () => d.resolve() };
            };
            const poll = async (label: string, check: () => Promise<boolean>, left = 250): Promise<void> => {
                if (await check()) return;
                if (left === 0) throw new Error(`${label} にならない`);
                await new Promise((r) => setTimeout(r, 20));
                return poll(label, check, left - 1);
            };
            /** 参照のロック（掃除と保存の順番）の、取れている・待っている mode */
            const referenceLocks = async () =>
                db.execute<{ mode: string; granted: boolean }>(sql`
                    select mode, granted from pg_locks
                    where locktype = 'advisory' and objsubid = 1
                      and ((classid::bigint << 32) | objid::bigint) = hashtextextended('world-asset-references', 0)`);
            const hasReferenceLock = async (mode: 'ShareLock' | 'ExclusiveLock', granted: boolean) =>
                (await referenceLocks()).some((l) => l.mode === mode && l.granted === granted);
            const blockedBy = async (pid: number) => {
                const [row] = await db.execute<{ n: number }>(
                    sql`select count(*)::int as n from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`,
                );
                return (row?.n ?? 0) > 0;
            };
            /** 別の接続で `hold` を実行したまま、release まで commit しない */
            const holdOpen = async (
                hold: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>,
            ) => {
                const held = deferred();
                const release = deferred();
                const pid = { value: 0 };
                const done = db.transaction(async (tx) => {
                    const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
                    pid.value = row?.pid ?? 0;
                    await hold(tx);
                    held.resolve();
                    await release.promise;
                });
                await held.promise;
                return {
                    pid: pid.value,
                    release: async () => {
                        release.resolve();
                        await done;
                    },
                };
            };
            const settled = (promise: Promise<unknown>) => {
                const state = { done: false };
                void promise.then(
                    () => (state.done = true),
                    () => (state.done = true),
                );
                return state;
            };

            it.each([
                ['下書き', 'raced-draft'],
                ['版', 'raced-version'],
            ])(
                '掃除が参照を読む前に始まった保存（%s）が、古い使われていない画像を指してコミットしたら消さない',
                async (kind, label) => {
                    await upload(alice, label, old);
                    const created = await worldRepository.saveDraft(
                        { authorId: alice, worldName: `race-${label}-${stamp}` },
                        draft({}),
                    );
                    if (created.status !== 'draft') throw new Error('ワールドを作れませんでした');
                    const target = { authorId: alice, worldName: `race-${label}-${stamp}`, worldId: created.worldId };
                    const definition = { spec: { thumbnail: url(label) } };

                    // ワールドの行を押さえて、保存をトランザクションの途中（参照のロックを取った後）で止める
                    const row = await holdOpen(async (tx) => {
                        await tx
                            .select({ id: worlds.id })
                            .from(worlds)
                            .where(eq(worlds.id, created.worldId))
                            .for('update');
                    });
                    const saving =
                        kind === '下書き'
                            ? worldRepository.saveDraft(target, draft(definition))
                            : worldRepository.publish(target, publishInput(definition, `1.0.0-${label}`));
                    await poll('保存がワールドの行を待つ', () => blockedBy(row.pid));

                    const sweeping = worldAssetRepository.removeUnreferenced(cutoff, 1000);
                    const sweep = settled(sweeping);
                    await poll(
                        '掃除が保存を待つか、終わる',
                        async () => sweep.done || (await hasReferenceLock('ExclusiveLock', false)),
                    );

                    await row.release();
                    expect(await saving).toMatchObject({ worldId: created.worldId });
                    expect(named([label], await sweeping)).toEqual([]);
                    expect(await remaining([label])).toEqual([`alice:${label}`]);
                },
            );

            it('掃除が先に排他を取ったら、その回の判断に従う。保存は掃除のコミットを待ってから通る', async () => {
                const label = 'swept-first';
                await upload(alice, label, old);
                const worldName = `race-${label}-${stamp}`;

                // 版の表を押さえて、掃除を排他を取った後（DELETE の前）で止める（下書きの保存は版の表を使わない）
                const table = await holdOpen(async (tx) => {
                    await tx.execute(sql`lock table world_versions in access exclusive mode`);
                });
                const sweeping = worldAssetRepository.removeUnreferenced(cutoff, 1000);
                await poll(
                    '掃除が排他を取って版の表を待つ',
                    async () => (await hasReferenceLock('ExclusiveLock', true)) && (await blockedBy(table.pid)),
                );

                const saving = worldRepository.saveDraft(
                    { authorId: alice, worldName },
                    draft({ thumbnail: url(label) }),
                );
                const save = settled(saving);
                await poll('保存が掃除を待つ', () => hasReferenceLock('ShareLock', false));
                expect(save.done).toBe(false);

                await table.release();
                expect(named([label], await sweeping)).toEqual([`alice:${label}`]);
                const saved = await saving;
                if (saved.status !== 'draft') throw new Error('下書きを保存できませんでした');
                const [row] = await db
                    .select({ definition: worldDrafts.definition })
                    .from(worldDrafts)
                    .where(eq(worldDrafts.worldId, saved.worldId));
                expect(row?.definition).toEqual({ thumbnail: url(label) });
                expect(await remaining([label])).toEqual([]);
            });
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

        it('自動で消すのを止めた人の画像は消さない。戻せば次の掃除で消える', async () => {
            const labels = ['kept-by-choice', 'not-chosen'];
            await upload(alice, 'kept-by-choice', old);
            await upload(bob, 'not-chosen', old);
            expect(await userSettingsRepository.getStorage(alice)).toEqual({ autoCleanup: true });
            await userSettingsRepository.setStorage(alice, { autoCleanup: false });
            expect(await userSettingsRepository.getStorage(alice)).toEqual({ autoCleanup: false });

            expect(await sweepAll(labels)).toEqual(['bob:not-chosen']);
            expect(await remaining(labels)).toEqual(['alice:kept-by-choice']);

            await userSettingsRepository.setStorage(alice, { autoCleanup: true });
            expect(await sweepAll(labels)).toEqual(['alice:kept-by-choice']);
        });
    });

    describe('listByOwner の使っているワールド', () => {
        const hashOf = (label: string) => createHash('sha256').update(`${stamp}:list:${label}`).digest('base64url');
        const url = (label: string) => `https://ubi.example${worldAssetPath(hashOf(label))}`;

        it('自分のワールドの下書き・版から指されていれば、そのワールドを 1 回ずつ名前の順に返す。ほかの人のワールドは数えない', async () => {
            for (const label of ['both', 'version-only', 'bobs-only', 'unused']) {
                await worldAssetRepository.add(alice, image(hashOf(label)), 100_000);
            }
            const published = await worldRepository.publish(
                { authorId: alice, worldName: `b-list-${stamp}` },
                {
                    version: '1.0.0',
                    definition: { spec: { thumbnail: url('both'), image: url('version-only') } },
                    lock: null,
                    signature: {} as WorldSignature,
                    contentHash: `${stamp}-list`,
                },
            );
            if (published.status !== 'published') throw new Error('公開できませんでした');
            // 公開した後の下書きでも同じ画像を 2 回使う
            await worldRepository.saveDraft(
                { authorId: alice, worldName: `b-list-${stamp}`, worldId: published.worldId },
                { definition: { a: url('both'), b: url('both') }, lock: null, unpublish: false },
            );
            const drafted = await worldRepository.saveDraft(
                { authorId: alice, worldName: `a-list-${stamp}` },
                { definition: { a: url('both') }, lock: null, unpublish: false },
            );
            if (drafted.status !== 'draft') throw new Error('下書きを保存できませんでした');
            await worldRepository.saveDraft(
                { authorId: bob, worldName: `list-${stamp}` },
                { definition: { a: url('bobs-only') }, lock: null, unpublish: false },
            );

            const usedBy = new Map(
                (await worldAssetRepository.listByOwner(alice)).map((row) => [row.hash, row.usedBy] as const),
            );
            expect(usedBy.get(hashOf('both'))).toEqual([
                { worldId: drafted.worldId, worldName: `a-list-${stamp}` },
                { worldId: published.worldId, worldName: `b-list-${stamp}` },
            ]);
            expect(usedBy.get(hashOf('version-only'))).toEqual([
                { worldId: published.worldId, worldName: `b-list-${stamp}` },
            ]);
            expect(usedBy.get(hashOf('bobs-only'))).toEqual([]);
            expect(usedBy.get(hashOf('unused'))).toEqual([]);
        });
    });
});
