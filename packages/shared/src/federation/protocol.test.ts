import { describe, expect, it } from 'vitest';
import {
    buildFriendOffer,
    buildInvite,
    buildRequestInvite,
    buildResponse,
    FRIEND_OF,
    readActivity,
} from './activities';
import { actorKey, buildActorDocument, readActorDocument, webfingerActorUrl } from './actor';
import {
    circuitPauseMs,
    classifyDelivery,
    deliveryDeadline,
    isUnreachable,
    RETRY_DELAYS_MS,
    retryDelayMs,
} from './delivery';
import { acceptsNewContact, policyFor } from './domainPolicy';
import { ed25519Multikey } from './multikey';
import { buildNodeInfo, nodeInfoLinks, nodeInfoUrlFrom, readNodeInfo } from './nodeinfo';
import { REMOTE_SUMMARY_MAX_LENGTH } from './profileFields';
import { actorIdOfKey, FEDERATION_FEATURES, isActivityMediaType, keyIdOf } from './protocol';
import { JoinRequestSchema, PresenceResponseSchema } from './rpc';

const ALICE = 'https://a.example/ap/users/7Fq2aL';
const BOB = 'https://c.example/ap/users/9bQkR3';
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);

const aliceDoc = (patch: Record<string, unknown> = {}) => ({
    ...buildActorDocument({
        id: ALICE,
        type: 'Person',
        preferredUsername: 'alice',
        name: 'Alice',
        summary: 'hi',
        url: 'https://a.example/@alice',
        icon: 'https://a.example/api/v1/profiles/7Fq2aL/image',
        inbox: `${ALICE}/inbox`,
        sharedInbox: 'https://a.example/ap/inbox',
        keyId: keyIdOf(ALICE),
        publicKeyMultibase: ed25519Multikey(KEY),
        webfinger: 'alice@a.example',
        implements: [FEDERATION_FEATURES.friends],
    }),
    ...patch,
});

describe('readActorDocument', () => {
    it('自分で作った文書を読み直せる（鍵・表示・機能）', () => {
        const read = readActorDocument(aliceDoc(), ALICE);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.actor).toMatchObject({
            id: ALICE,
            preferredUsername: 'alice',
            name: 'Alice',
            inbox: `${ALICE}/inbox`,
            sharedInbox: 'https://a.example/ap/inbox',
            features: [FEDERATION_FEATURES.friends],
        });
        expect(actorKey(read.actor, keyIdOf(ALICE))).toEqual(KEY);
        expect(actorKey(read.actor, `${ALICE}#other`)).toBeNull();
    });

    it('取りに行った URL と id が違えば受けない（別のオリジンの文書で乗っ取らせない）', () => {
        expect(readActorDocument(aliceDoc(), 'https://evil.example/ap/users/7Fq2aL')).toEqual({
            ok: false,
            reason: 'id-mismatch',
        });
    });

    it('inbox・sharedInbox が別のオリジンなら受けない（第三者へ送らせない）', () => {
        expect(readActorDocument(aliceDoc({ inbox: 'https://victim.example/inbox' }), ALICE)).toEqual({
            ok: false,
            reason: 'inbox-origin',
        });
        expect(
            readActorDocument(aliceDoc({ endpoints: { sharedInbox: 'https://victim.example/inbox' } }), ALICE),
        ).toEqual({ ok: false, reason: 'inbox-origin' });
    });

    it('controller が違う・id が actor の下でない・Multikey でない鍵は使わない', () => {
        const methods = [
            { id: `${ALICE}#k1`, type: 'Multikey', controller: BOB, publicKeyMultibase: ed25519Multikey(KEY) },
            { id: `${BOB}#k2`, type: 'Multikey', controller: ALICE, publicKeyMultibase: ed25519Multikey(KEY) },
            { id: `${ALICE}#k3`, type: 'JsonWebKey', controller: ALICE, publicKeyMultibase: ed25519Multikey(KEY) },
            { id: `${ALICE}#k4`, type: 'Multikey', controller: ALICE, publicKeyMultibase: 'zBroken' },
        ];
        const read = readActorDocument(aliceDoc({ assertionMethod: methods }), ALICE);
        expect(read.ok && read.actor.keys).toEqual([]);
    });

    it('http の actor は開発のときだけ受ける', () => {
        const local = 'http://localhost:3201/ap/users/x';
        const doc = { ...aliceDoc(), id: local, inbox: `${local}/inbox`, endpoints: {}, assertionMethod: [] };
        expect(readActorDocument(doc, local).ok).toBe(false);
        expect(readActorDocument(doc, local, { allowHttp: true }).ok).toBe(true);
    });

    it('表示の文字列はタグと制御文字を除き、長さを切る。知らない項目は無視する', () => {
        const read = readActorDocument(
            aliceDoc({ name: '<b>Al\u0007ice</b>', summary: 'x'.repeat(5000), extra: { anything: true } }),
            ALICE,
        );
        expect(read.ok && read.actor.name).toBe('Alice');
        expect(read.ok && read.actor.summary?.length).toBe(REMOTE_SUMMARY_MAX_LENGTH);
    });

    it('icon・url が URL でなければ捨てる', () => {
        const read = readActorDocument(aliceDoc({ icon: { url: 'javascript:alert(1)' }, url: 'file:///etc' }), ALICE);
        expect(read.ok && read.actor.icon).toBeNull();
        expect(read.ok && read.actor.url).toBeNull();
    });
});

describe('webfingerActorUrl', () => {
    it('AP のメディアタイプの self を選ぶ', () => {
        expect(
            webfingerActorUrl({
                links: [
                    { rel: 'self', type: 'text/html', href: 'https://a.example/@alice' },
                    { rel: 'self', type: 'application/activity+json', href: ALICE },
                ],
            }),
        ).toBe(ALICE);
        expect(webfingerActorUrl({ links: [] })).toBeNull();
        expect(webfingerActorUrl('nope')).toBeNull();
    });
});

describe('activities', () => {
    it('フレンドの申請を作って読み直せる', () => {
        const offer = buildFriendOffer({
            id: 'https://a.example/ap/activities/1',
            actor: ALICE,
            target: BOB,
            relationshipId: 'https://a.example/ap/friendships/1',
            published: '2026-11-07T00:00:00Z',
        });
        expect(readActivity(offer)).toEqual({
            ok: true,
            activity: {
                type: 'friend-offer',
                id: 'https://a.example/ap/activities/1',
                actor: ALICE,
                target: BOB,
                relationshipId: 'https://a.example/ap/friendships/1',
            },
        });
    });

    it('申請の主体が actor でない・相手が食い違う・friendOf でない申請は意味の分からないものとして扱う', () => {
        const offer = (patch: Record<string, unknown>) => ({
            id: 'https://a.example/ap/activities/1',
            type: 'Offer',
            actor: ALICE,
            target: BOB,
            object: {
                id: 'https://a.example/ap/friendships/1',
                type: 'Relationship',
                subject: ALICE,
                relationship: FRIEND_OF,
                object: BOB,
                ...patch,
            },
        });
        for (const patch of [
            { subject: 'https://a.example/ap/users/mallory' },
            { object: 'https://c.example/ap/users/x' },
            { relationship: 'http://example/enemyOf' },
        ]) {
            const read = readActivity(offer(patch));
            expect(read.ok && read.activity.type).toBe('unknown');
        }
    });

    it('activity の id と actor が別のオリジンなら受けない', () => {
        expect(
            readActivity({ id: 'https://evil.example/ap/activities/1', type: 'Undo', actor: ALICE, object: 'x' }),
        ).toEqual({ ok: false, reason: 'cross-origin' });
    });

    it('Accept・Reject・Undo の object は文字列でも埋め込みでも読む', () => {
        const accept = buildResponse('Accept', {
            id: 'https://c.example/ap/activities/2',
            actor: BOB,
            to: ALICE,
            object: { id: 'https://a.example/ap/activities/1', type: 'Offer', actor: ALICE },
        });
        expect(readActivity(accept)).toMatchObject({
            ok: true,
            activity: {
                type: 'accept',
                object: { id: 'https://a.example/ap/activities/1', type: 'Offer', actor: ALICE },
            },
        });
        const undo = {
            id: 'https://c.example/ap/activities/3',
            type: 'Undo',
            actor: BOB,
            object: 'https://c.example/ap/activities/2',
        };
        expect(readActivity(undo)).toMatchObject({
            ok: true,
            activity: { type: 'undo', object: { id: 'https://c.example/ap/activities/2', type: '' } },
        });
    });

    it('招待を作って読み直せる。一言はタグを除き 80 字に切る', () => {
        const invite = buildInvite({
            id: 'https://a.example/ap/activities/4',
            actor: ALICE,
            target: BOB,
            room: {
                id: 'https://b.example/ap/instances/i9Wm',
                name: 'Forest',
                image: 'https://b.example/t.png',
                accessType: 'friend_plus',
            },
            content: `<script>x</script>${'あ'.repeat(100)}`,
            endTime: '2026-11-08T09:00:00Z',
            inReplyTo: 'https://c.example/ap/activities/9',
        });
        const read = readActivity(invite);
        expect(read.ok && read.activity).toMatchObject({
            type: 'invite',
            target: BOB,
            room: {
                id: 'https://b.example/ap/instances/i9Wm',
                name: 'Forest',
                image: 'https://b.example/t.png',
                accessType: 'friend_plus',
            },
            endTime: '2026-11-08T09:00:00Z',
            inReplyTo: 'https://c.example/ap/activities/9',
        });
        expect(read.ok && read.activity.type === 'invite' && read.activity.content?.length).toBe(80);
    });

    it('期限の無い招待・リクエストは意味の分からないものとして捨てる', () => {
        const read = readActivity({
            id: 'https://a.example/ap/activities/5',
            type: 'Invite',
            actor: ALICE,
            target: BOB,
            object: { id: 'https://b.example/ap/instances/x', type: 'Instance' },
        });
        expect(read.ok && read.activity.type).toBe('unknown');
    });

    it('リクエストインバイトを作って読み直せる', () => {
        const request = buildRequestInvite({
            id: 'https://c.example/ap/activities/6',
            actor: BOB,
            target: ALICE,
            content: null,
            endTime: '2026-11-07T10:00:00Z',
        });
        expect(readActivity(request)).toMatchObject({
            ok: true,
            activity: { type: 'request-invite', actor: BOB, target: ALICE, content: null },
        });
    });

    it('自分以外を消す・更新する Delete・Update は捨てる。知らない型・項目は捨てるだけ', () => {
        const del = readActivity({
            id: `${ALICE}#delete`,
            type: 'Delete',
            actor: ALICE,
            object: 'https://a.example/ap/users/other',
        });
        expect(del.ok && del.activity.type).toBe('unknown');
        const own = readActivity({ id: `${ALICE}#delete`, type: 'Delete', actor: ALICE, object: ALICE });
        expect(own.ok && own.activity.type).toBe('delete-actor');
        const like = readActivity({
            id: 'https://a.example/ap/activities/7',
            type: 'Like',
            actor: ALICE,
            object: 'x',
            future: 1,
        });
        expect(like).toEqual({
            ok: true,
            activity: { type: 'unknown', id: 'https://a.example/ap/activities/7', actor: ALICE, activityType: 'Like' },
        });
        expect(readActivity({ type: 'Like' })).toEqual({ ok: false, reason: 'malformed' });
    });
});

describe('domainPolicy', () => {
    const restrictions = new Map([
        ['spam.example', 'block' as const],
        ['noisy.example', 'limit' as const],
        ['a.noisy.example', 'block' as const],
    ]);

    it('サブドメインにも効き、いちばん強い方針になる。ポートは無視する', () => {
        expect(policyFor('spam.example', restrictions)).toBe('block');
        expect(policyFor('x.spam.example:8443', restrictions)).toBe('block');
        expect(policyFor('b.noisy.example', restrictions)).toBe('limit');
        expect(policyFor('a.noisy.example', restrictions)).toBe('block');
        expect(policyFor('notspam.example', restrictions)).toBe('allow');
        expect(acceptsNewContact(policyFor('noisy.example', restrictions))).toBe(false);
    });
});

describe('delivery', () => {
    it('送り直しの間隔は表のとおりで、±20% のゆらぎの中。最後の間隔より伸びない', () => {
        expect(retryDelayMs(1, 0.5)).toBe(RETRY_DELAYS_MS[0]);
        expect(retryDelayMs(1, 0)).toBe(24_000);
        expect(retryDelayMs(1, 1)).toBe(36_000);
        expect(retryDelayMs(99, 0.5)).toBe(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    });

    it('48 時間か期限の早い方で諦める', () => {
        expect(deliveryDeadline(0)).toBe(48 * 3600_000);
        expect(deliveryDeadline(0, 3600_000)).toBe(3600_000);
    });

    it('応答ごとの扱い', () => {
        expect(classifyDelivery(202)).toEqual({ kind: 'delivered' });
        expect(classifyDelivery(410)).toEqual({ kind: 'rejected', gone: true });
        expect(classifyDelivery(404)).toEqual({ kind: 'rejected', gone: false });
        // 相手が古い鍵を覚えているだけのことがある（鍵の差し替え直後）。取り直せば通るので送り直す
        expect(classifyDelivery(401)).toEqual({ kind: 'retry' });
        expect(classifyDelivery(503)).toEqual({ kind: 'retry' });
        expect(classifyDelivery(null)).toEqual({ kind: 'retry' });
        expect(classifyDelivery(429, '120', 0)).toEqual({ kind: 'retry', retryAfterMs: 120_000 });
        expect(classifyDelivery(429, '999999', 0)).toEqual({ kind: 'retry', retryAfterMs: 3600_000 });
        expect(classifyDelivery(429, 'Thu, 01 Jan 1970 00:00:10 GMT', 0)).toEqual({
            kind: 'retry',
            retryAfterMs: 10_000,
        });
    });

    it('続けて 5 回失敗したら止め、続くたびに倍（最長 1 時間）', () => {
        expect(circuitPauseMs(4)).toBe(0);
        expect(circuitPauseMs(5)).toBe(60_000);
        expect(circuitPauseMs(6)).toBe(120_000);
        expect(circuitPauseMs(50)).toBe(3600_000);
    });

    it('成功しないまま 3 日で到達できないとみなす', () => {
        expect(isUnreachable(null, 0)).toBe(false);
        expect(isUnreachable(0, 3 * 86400_000 - 1)).toBe(false);
        expect(isUnreachable(0, 3 * 86400_000)).toBe(true);
    });
});

describe('nodeinfo・protocol', () => {
    it('ubichill のサーバーを判別する。ほかのソフトは連合の版を持たない', () => {
        expect(readNodeInfo(buildNodeInfo({ version: '4.2.0', openRegistrations: true }))).toEqual({
            software: 'ubichill',
            version: '4.2.0',
            federationVersion: 1,
        });
        expect(readNodeInfo({ software: { name: 'Mastodon', version: '4.7.0' } })).toEqual({
            software: 'mastodon',
            version: '4.7.0',
            federationVersion: null,
        });
        expect(nodeInfoUrlFrom(nodeInfoLinks('https://a.example'))).toBe('https://a.example/nodeinfo/2.1');
    });

    it('鍵の id と actor の id', () => {
        expect(keyIdOf(ALICE)).toBe(`${ALICE}#ed25519-1`);
        expect(actorIdOfKey(`${ALICE}#ed25519-1`)).toBe(ALICE);
    });

    it('AP のメディアタイプ（ld+json は profile 付きだけ）', () => {
        expect(isActivityMediaType('application/activity+json; charset=utf-8')).toBe(true);
        expect(isActivityMediaType('application/ld+json; profile="https://www.w3.org/ns/activitystreams"')).toBe(true);
        expect(isActivityMediaType('application/ld+json')).toBe(false);
        expect(isActivityMediaType('text/html')).toBe(false);
    });

    it('RPC の知らない項目は無視する（相手の版が新しくても壊れない）', () => {
        expect(
            JoinRequestSchema.safeParse({
                room: 'https://b.example/ap/instances/x',
                clientOrigin: 'https://c.example',
                future: 1,
            }).success,
        ).toBe(true);
        expect(
            PresenceResponseSchema.safeParse({ presence: [{ subject: ALICE, status: 'teleporting' }], ttl: 15 })
                .success,
        ).toBe(false);
    });
});
