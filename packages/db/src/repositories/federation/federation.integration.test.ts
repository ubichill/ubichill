import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inviteRepository } from '../inviteRepository';
import { userRepository } from '../userRepository';
import { deliveryRepository } from './deliveryRepository';
import { federationSeenRepository } from './federationSeenRepository';
import { remoteActorRepository } from './remoteActorRepository';
import { remoteFriendshipRepository } from './remoteFriendshipRepository';
import { remoteServerRepository } from './remoteServerRepository';
import { remoteVisitRepository } from './remoteVisitRepository';

/** 連合の保存（DB 統合）。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const T0 = new Date('2026-11-07T00:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const userId = `fed-u-${stamp}`;
const host = `peer-${stamp}.example`;
const actorId = (n: number) => `https://${host}/ap/users/${n}`;

const actor = (n: number, account = `user${n}@${host}`) => ({
    id: actorId(n),
    account,
    domain: host,
    type: 'Person',
    name: `User ${n}`,
    summary: null,
    icon: null,
    url: null,
    inbox: `${actorId(n)}/inbox`,
    sharedInbox: `https://${host}/ap/inbox`,
    keys: [{ id: `${actorId(n)}#ed25519-1`, publicKeyMultibase: 'z6Mk' }],
    features: [],
    fetchedAt: T0,
});

describe.skipIf(!RUN)('連合の保存（DB統合）', () => {
    beforeAll(async () => {
        await userRepository.create({
            id: userId,
            name: userId,
            email: `${userId}@example.com`,
            handle: userId.replaceAll('-', '_'),
        });
    });
    afterAll(async () => {
        await userRepository.deleteById(userId);
    });

    describe('remoteActorRepository', () => {
        it('同じアカウントで作り直された actor は、古い actor を捨てて置き換える', async () => {
            await remoteActorRepository.upsert(actor(1, `moved@${host}`));
            await remoteActorRepository.upsert(actor(2, `moved@${host}`));
            expect(await remoteActorRepository.findById(actorId(1))).toBeUndefined();
            expect((await remoteActorRepository.findByAccount(`moved@${host}`))?.id).toBe(actorId(2));
        });

        it('消えた印は、取り直して保存すると外れる', async () => {
            await remoteActorRepository.upsert(actor(3));
            await remoteActorRepository.markDeleted(actorId(3), T0);
            expect((await remoteActorRepository.findById(actorId(3)))?.deletedAt).not.toBeNull();
            await remoteActorRepository.upsert(actor(3));
            expect((await remoteActorRepository.findById(actorId(3)))?.deletedAt).toBeNull();
        });
    });

    describe('remoteFriendshipRepository', () => {
        it('申請 → 承認と、消えた actor の関係は一覧に出さない', async () => {
            await remoteActorRepository.upsert(actor(4));
            await remoteFriendshipRepository.put(
                { userId, actorId: actorId(4), state: 'outgoing', offerId: 'o4', relationshipId: 'r4' },
                T0,
            );
            await remoteFriendshipRepository.put(
                { userId, actorId: actorId(4), state: 'accepted', offerId: 'o4', relationshipId: 'r4', acceptId: 'a4' },
                at(1000),
            );
            expect(await remoteFriendshipRepository.acceptedUsersOf(actorId(4))).toEqual([userId]);
            expect((await remoteFriendshipRepository.findByOffer('o4'))[0]?.acceptId).toBe('a4');
            const listed = await remoteFriendshipRepository.listForUser(userId);
            expect(listed.find((f) => f.actorId === actorId(4))).toMatchObject({
                account: `user4@${host}`,
                state: 'accepted',
            });
            await remoteActorRepository.markDeleted(actorId(4), at(2000));
            expect((await remoteFriendshipRepository.listForUser(userId)).some((f) => f.actorId === actorId(4))).toBe(
                false,
            );
        });

        it('受けたまま 30 日の申請と、冷却期間の過ぎた断った記録を消す', async () => {
            await remoteActorRepository.upsert(actor(5));
            await remoteActorRepository.upsert(actor(6));
            await remoteFriendshipRepository.put(
                { userId, actorId: actorId(5), state: 'incoming', offerId: 'o5', relationshipId: 'r5' },
                T0,
            );
            await remoteFriendshipRepository.put(
                { userId, actorId: actorId(6), state: 'rejected', offerId: 'o6', relationshipId: 'r6' },
                at(10_000),
            );
            expect(await remoteFriendshipRepository.countIncoming(userId)).toBe(1);
            expect(await remoteFriendshipRepository.deleteStale(at(1), at(5_000))).toBe(1);
            expect(await remoteFriendshipRepository.get(userId, actorId(6))).toBeDefined();
            expect(await remoteFriendshipRepository.deleteStale(at(1), at(20_000))).toBe(1);
        });
    });

    describe('deliveryRepository', () => {
        const enqueue = (id: string, orderKey: string, created: number, deadline = 3_600_000) =>
            deliveryRepository.enqueue(
                {
                    id: `${stamp}-${id}`,
                    senderUserId: userId,
                    inbox: `https://${host}/ap/inbox`,
                    host,
                    body: { id },
                    orderKey: `${stamp}|${orderKey}`,
                    deadlineAt: at(deadline),
                },
                at(created),
            );
        const claimedIds = (rows: Array<{ id: string }>) => rows.map((r) => r.id.replace(`${stamp}-`, ''));

        it('同じ組は古いものから 1 つずつ。取り出したものは、ほかの backend が取らない', async () => {
            await enqueue('a1', 'alice|bob', 0);
            await enqueue('a2', 'alice|bob', 10);
            await enqueue('c1', 'carol|bob', 20);
            const first = await deliveryRepository.claimDue({
                now: at(1000),
                limit: 10,
                lockMs: 30_000,
                excludedHosts: [],
            });
            expect(claimedIds(first).sort()).toEqual(['a1', 'c1']);
            const second = await deliveryRepository.claimDue({
                now: at(1000),
                limit: 10,
                lockMs: 30_000,
                excludedHosts: [],
            });
            expect(claimedIds(second)).toEqual([]);
            await deliveryRepository.remove(`${stamp}-a1`);
            const third = await deliveryRepository.claimDue({
                now: at(2000),
                limit: 10,
                lockMs: 30_000,
                excludedHosts: [],
            });
            expect(claimedIds(third)).toEqual(['a2']);
        });

        it('送り直しは時刻が来るまで取らず、止めているホストは除く', async () => {
            await deliveryRepository.reschedule(`${stamp}-a2`, at(60_000), 'timeout');
            expect(
                claimedIds(
                    await deliveryRepository.claimDue({ now: at(30_000), limit: 10, lockMs: 1, excludedHosts: [] }),
                ),
            ).not.toContain('a2');
            expect(
                claimedIds(
                    await deliveryRepository.claimDue({ now: at(61_000), limit: 10, lockMs: 1, excludedHosts: [host] }),
                ),
            ).toEqual([]);
            const due = await deliveryRepository.claimDue({ now: at(61_000), limit: 10, lockMs: 1, excludedHosts: [] });
            expect(due.find((d) => d.id.endsWith('a2'))).toMatchObject({ attempts: 1, lastError: 'timeout' });
        });

        it('期限を過ぎたものは諦める', async () => {
            await enqueue('old', 'x|y', 0, 100);
            expect(await deliveryRepository.deleteExpired(at(200))).toBeGreaterThanOrEqual(1);
        });
    });

    describe('federationSeenRepository', () => {
        it('期限内の 2 度目は false、期限が過ぎたら覚え直す', async () => {
            const key = `seen-${stamp}`;
            expect(await federationSeenRepository.remember(key, at(1000), T0)).toBe(true);
            expect(await federationSeenRepository.remember(key, at(5000), at(500))).toBe(false);
            expect(await federationSeenRepository.remember(key, at(5000), at(1000))).toBe(true);
        });
    });

    describe('連合で足した口', () => {
        const friend = (n: number, domain: string) => ({
            ...actor(n, `user${n}@${domain}`),
            id: `https://${domain}/ap/users/${n}-${stamp}`,
            domain,
            inbox: `https://${domain}/ap/users/${n}/inbox`,
        });
        const befriend = async (a: ReturnType<typeof friend>) => {
            await remoteActorRepository.upsert(a);
            await remoteFriendshipRepository.put(
                { userId, actorId: a.id, state: 'accepted', offerId: `o-${a.id}`, relationshipId: `r-${a.id}` },
                T0,
            );
        };

        it('フレンドの actor（消えた actor は除く）', async () => {
            const kept = friend(20, `kept-${stamp}.example`);
            const gone = friend(21, `gone-${stamp}.example`);
            await befriend(kept);
            await befriend(gone);
            await remoteActorRepository.markDeleted(gone.id, T0);
            const actors = await remoteFriendshipRepository.acceptedActorsOf(userId);
            expect(actors).toContain(kept.id);
            expect(actors).not.toContain(gone.id);
        });

        it('連合しないドメインの関係を消す: ポート違い・サブドメインも消し、名前が似ているだけのドメインは残す', async () => {
            const base = `blocked-${stamp}.example`;
            const same = friend(30, base);
            const port = friend(31, `${base}:8443`);
            const sub = friend(32, `a.${base}`);
            const lookalike = friend(33, `not${base}`);
            for (const a of [same, port, sub, lookalike]) await befriend(a);
            const removed = await remoteFriendshipRepository.removeForDomain(base);
            expect(removed.map((r) => r.actorId).sort()).toEqual([same.id, port.id, sub.id].sort());
            expect(await remoteFriendshipRepository.get(userId, lookalike.id)).toBeDefined();
        });

        it('来訪は知らせが途切れたら引けない', async () => {
            const room = {
                id: `https://${host}/ap/instances/r1`,
                name: '森',
                image: null,
                accessType: 'public' as const,
                members: 1,
                capacity: 10,
                leader: actorId(1),
                world: { url: `https://${host}/worlds/forest`, name: '森' },
            };
            await remoteVisitRepository.set(userId, room.id, room, T0);
            expect((await remoteVisitRepository.get(userId, at(-1000)))?.room.name).toBe('森');
            expect(await remoteVisitRepository.get(userId, at(1000))).toBeUndefined();
            await remoteVisitRepository.clear(userId);
        });

        it('覚えた id を忘れると、もう一度覚えられる（処理に失敗したとき）', async () => {
            const key = `activity|https://${host}/ap/activities/forget-${stamp}`;
            expect(await federationSeenRepository.remember(key, at(60_000), T0)).toBe(true);
            await federationSeenRepository.forget(key);
            expect(await federationSeenRepository.remember(key, at(60_000), T0)).toBe(true);
        });

        it('ほかのサーバーの人へのリクエストも、届いたリクエストの activity の id も持てる', async () => {
            const target = actorId(40);
            const expiresAt = new Date(Date.now() + 60_000);
            expect(await inviteRepository.createRequest({ requesterId: userId, targetId: target, expiresAt })).toBe(
                'created',
            );
            expect(await inviteRepository.createRequest({ requesterId: userId, targetId: target, expiresAt })).toBe(
                'exists',
            );
            expect(
                await inviteRepository.createRequest({
                    requesterId: actorId(41),
                    targetId: userId,
                    expiresAt,
                    activityId: `https://${host}/ap/activities/req`,
                }),
            ).toBe('created');
            expect(await inviteRepository.hasRequest(actorId(41), userId)).toBe(true);
            await inviteRepository.removeRequest(userId, target);
            await inviteRepository.removeRequest(actorId(41), userId);
        });
    });

    describe('remoteServerRepository', () => {
        it('失敗を続けて数え、成功で戻す', async () => {
            const domain = `srv-${stamp}.example`;
            expect(await remoteServerRepository.recordFailure(domain, T0)).toBe(1);
            expect(
                await remoteServerRepository.recordFailure(domain, at(1000), (n) => (n >= 2 ? at(60_000) : null)),
            ).toBe(2);
            const failing = await remoteServerRepository.get(domain);
            expect(failing?.failingSince?.getTime()).toBe(T0.getTime());
            expect(failing?.pausedUntil?.getTime()).toBe(at(60_000).getTime());
            await remoteServerRepository.recordSuccess(domain, at(2000));
            expect(await remoteServerRepository.get(domain)).toMatchObject({
                consecutiveFailures: 0,
                failingSince: null,
                pausedUntil: null,
            });
        });
    });
});
