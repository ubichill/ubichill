import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { favoriteRepository } from '../favoriteRepository';
import { userRepository } from '../userRepository';
import { userSettingsRepository } from '../userSettingsRepository';
import { actorKeyRepository } from './actorKeyRepository';
import { deliveryRepository } from './deliveryRepository';
import { followerRepository } from './followerRepository';
import { remoteActorRepository } from './remoteActorRepository';

/** フェディバースのフォロー・RSA の鍵・設定の保存（DB 統合）。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const T0 = new Date('2026-11-09T00:00:00.000Z');
const userId = `fv-u-${stamp}`;
const host = `misskey-${stamp}.example`;
const actorId = (n: number) => `https://${host}/users/${n}`;

const actor = (n: number) => ({
    id: actorId(n),
    account: `u${n}@${host}`,
    domain: host,
    type: 'Person',
    name: `U ${n}`,
    summary: null,
    icon: null,
    banner: null,
    profile: {},
    url: null,
    inbox: `${actorId(n)}/inbox`,
    sharedInbox: `https://${host}/inbox`,
    keys: [{ id: `${actorId(n)}#main-key`, publicKeyPem: '-----BEGIN PUBLIC KEY-----\nAA\n-----END PUBLIC KEY-----' }],
    features: [],
    fetchedAt: T0,
});

const delivery = (id: string) => ({
    id,
    senderUserId: userId,
    inbox: `${actorId(1)}/inbox`,
    host,
    body: { id, type: 'Accept' },
    orderKey: `x|${actorId(1)}`,
    deadlineAt: new Date(T0.getTime() + 60_000),
});

describe.skipIf(!RUN)('フェディバースの保存（DB統合）', () => {
    beforeAll(async () => {
        await userRepository.create({
            id: userId,
            name: userId,
            email: `${userId}@example.com`,
            handle: userId.replaceAll('-', '_'),
        });
        for (const n of [1, 2, 3, 4]) await remoteActorRepository.upsert(actor(n));
    });
    afterAll(async () => {
        await userRepository.deleteById(userId);
    });

    describe('followerRepository', () => {
        it('locked の中の書き込みと送る予定は一緒に確定し、投げたら両方戻る', async () => {
            await expect(
                followerRepository.locked(userId, actorId(1), async (_row, write) => {
                    await write.put({ state: 'accepted', followId: 'f-rolled-back' }, T0);
                    await write.enqueue(delivery(`d-rb-${stamp}`), T0);
                    throw new Error('途中で失敗');
                }),
            ).rejects.toThrow('途中で失敗');
            expect(await followerRepository.get(userId, actorId(1))).toBeUndefined();
            const claimed = await deliveryRepository.claimDue({
                now: new Date(T0.getTime() + 1000),
                limit: 100,
                lockMs: 1,
                excludedHosts: [],
            });
            expect(claimed.some((d) => d.id === `d-rb-${stamp}`)).toBe(false);

            await followerRepository.locked(userId, actorId(1), async (row, write) => {
                expect(row).toBeUndefined();
                await write.put({ state: 'pending', followId: `f1-${stamp}` }, T0);
                expect(await write.countPending()).toBe(1);
            });
            expect(await followerRepository.get(userId, actorId(1))).toMatchObject({ state: 'pending' });
        });

        it('同じ 2 人の locked は順番に走る（後の方は先の書き込みを読む）', async () => {
            const order: string[] = [];
            await Promise.all([
                followerRepository.locked(userId, actorId(2), async (row, write) => {
                    order.push(`first:${row?.state ?? 'none'}`);
                    await new Promise((r) => setTimeout(r, 50));
                    await write.put({ state: 'accepted', followId: `f2-${stamp}` }, T0);
                }),
                new Promise((r) => setTimeout(r, 10)).then(() =>
                    followerRepository.locked(userId, actorId(2), async (row) => {
                        order.push(`second:${row?.state ?? 'none'}`);
                    }),
                ),
            ]);
            expect(order).toEqual(['first:none', 'second:accepted']);
        });

        it('一覧・数・届け先は状態ごとに分け、消えた actor を除く。Follow の id で引ける', async () => {
            await followerRepository.locked(userId, actorId(3), (_r, w) =>
                w.put({ state: 'accepted', followId: `f3-${stamp}` }, T0),
            );
            await remoteActorRepository.markDeleted(actorId(3), T0);
            expect((await followerRepository.listForUser(userId, 'pending', 10)).map((f) => f.account)).toEqual([
                `u1@${host}`,
            ]);
            expect((await followerRepository.listForUser(userId, 'accepted', 10)).map((f) => f.account)).toEqual([
                `u2@${host}`,
            ]);
            expect(await followerRepository.countAccepted(userId)).toBe(1);
            expect((await followerRepository.acceptedActorsOf(userId)).map((a) => a.id)).toEqual([actorId(2)]);
            expect(await followerRepository.pendingActorIdsOf(userId)).toEqual([actorId(1)]);
            expect((await followerRepository.findByFollowId(`f2-${stamp}`)).map((r) => r.actorId)).toEqual([
                actorId(2),
            ]);
            // 消えた actor のフォローは掃除で消える
            expect((await followerRepository.removeForDeletedActors()).map((r) => r.actorId)).toContain(actorId(3));
        });

        it('ドメインを block したら、そのドメイン（サブドメインも）の actor のフォローを消す', async () => {
            const removed = await followerRepository.removeForDomain(host.split('.').slice(-2).join('.'));
            expect(removed.map((r) => r.actorId).sort()).toEqual([actorId(1), actorId(2)]);
            expect(await followerRepository.countAccepted(userId)).toBe(0);
        });
    });

    describe('actorKeyRepository', () => {
        const key = (n: number) => ({
            actorId: `https://a.example/ap/users/${userId}`,
            userId,
            publicKeyPem: `pem-${n}`,
            privateKeyEncrypted: `wrapped-${n}`,
        });

        it('同時に入れても先に入ったほうだけが残る', async () => {
            const [a, b] = await Promise.all([
                actorKeyRepository.insertIfAbsent(key(1), T0),
                actorKeyRepository.insertIfAbsent(key(2), T0),
            ]);
            expect(a.publicKeyPem).toBe(b.publicKeyPem);
        });

        it('作り直しは、読めなかった行のままのときだけ書き換える（ほかの backend が先に作り直していたらそれを返す）', async () => {
            const stored = await actorKeyRepository.get(key(1).actorId);
            const stale = stored?.privateKeyEncrypted ?? '';
            const replaced = await actorKeyRepository.replace(key(3), stale, T0);
            expect(replaced.publicKeyPem).toBe('pem-3');
            const late = await actorKeyRepository.replace(key(4), stale, T0);
            expect(late.publicKeyPem).toBe('pem-3');
        });

        it('ユーザーが消えたら鍵も消える', async () => {
            const other = `fv-gone-${stamp}`;
            await userRepository.create({
                id: other,
                name: other,
                email: `${other}@example.com`,
                handle: other.replaceAll('-', '_'),
            });
            await actorKeyRepository.insertIfAbsent(
                { ...key(5), actorId: `https://a.example/ap/users/${other}`, userId: other },
                T0,
            );
            await userRepository.deleteById(other);
            expect(await actorKeyRepository.get(`https://a.example/ap/users/${other}`)).toBeUndefined();
        });
    });

    describe('favoriteRepository.latest（固定ノートのお気に入り）', () => {
        it('新しく追加した順に、追加した時刻つきで limit 件まで返す', async () => {
            for (const n of [1, 2, 3]) {
                await favoriteRepository.add(userId, `https://worlds.example/${stamp}/${n}.yaml`);
                await new Promise((r) => setTimeout(r, 5));
            }
            const latest = await favoriteRepository.latest(userId, 2);
            expect(latest.map((f) => f.worldRef)).toEqual([
                `https://worlds.example/${stamp}/3.yaml`,
                `https://worlds.example/${stamp}/2.yaml`,
            ]);
            expect(latest[0]?.createdAt).toBeInstanceOf(Date);
        });
    });

    describe('userSettingsRepository（フェディバース）', () => {
        it('行が無ければ初期値（承認しない・検索に出す）、渡した項目だけ変え、ほかの設定は戻さない', async () => {
            expect(await userSettingsRepository.getFediverse(userId)).toEqual({
                manuallyApprovesFollowers: false,
                discoverable: true,
            });
            await userSettingsRepository.setFavoritesVisibility(userId, 'public');
            expect(await userSettingsRepository.updateFediverse(userId, { manuallyApprovesFollowers: true })).toEqual({
                manuallyApprovesFollowers: true,
                discoverable: true,
            });
            expect(await userSettingsRepository.updateFediverse(userId, { discoverable: false })).toEqual({
                manuallyApprovesFollowers: true,
                discoverable: false,
            });
            expect(await userSettingsRepository.getFavoritesVisibility(userId)).toBe('public');
        });
    });
});
