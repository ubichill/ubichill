import type { RemoteActorInput, RemoteActorRecord } from '@ubichill/db';
import { buildActorDocument, type DomainPolicy, ed25519Multikey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createActorDirectory } from './actors';
import { createFederationIdentity } from './identity';
import type { FederationResponse } from './transport';

const NOW = Date.parse('2026-11-07T00:00:00Z');
const BOB = 'https://b.example/ap/users/bob';
const KEY = ed25519Multikey(new Uint8Array(32).fill(3));

const person = (id = BOB, overrides: Record<string, unknown> = {}) => ({
    ...buildActorDocument({
        id,
        type: 'Person',
        preferredUsername: 'bob',
        name: 'Bob',
        inbox: `${id}/inbox`,
        sharedInbox: `${new URL(id).origin}/ap/inbox`,
        keyId: `${id}#ed25519-1`,
        publicKeyMultibase: KEY,
    }),
    ...overrides,
});
const app = (origin = 'https://b.example') =>
    buildActorDocument({
        id: `${origin}/ap/actor`,
        type: 'Application',
        preferredUsername: new URL(origin).host,
        name: 'ubichill',
        inbox: `${origin}/ap/inbox`,
        sharedInbox: `${origin}/ap/inbox`,
        keyId: `${origin}/ap/actor#ed25519-1`,
        publicKeyMultibase: KEY,
    });
const ap = (json: unknown, status = 200): FederationResponse => ({
    status,
    contentType: 'application/activity+json',
    json,
    retryAfter: null,
});
const jrd = (self: string): FederationResponse => ({
    status: 200,
    contentType: 'application/jrd+json',
    json: { subject: 'acct:bob@b.example', links: [{ rel: 'self', type: 'application/activity+json', href: self }] },
    retryAfter: null,
});

function setup(options: { routes: Record<string, FederationResponse>; policy?: DomainPolicy }) {
    const store = new Map<string, RemoteActorRecord>();
    const fetched: string[] = [];
    const directory = createActorDirectory({
        identity: createFederationIdentity('https://a.example'),
        allowHttp: false,
        repo: {
            findById: async (id) => store.get(id),
            findByAccount: async (account) => [...store.values()].find((a) => a.account === account),
            upsert: async (input: RemoteActorInput) => {
                const record = { ...input, deletedAt: null, createdAt: new Date(NOW) };
                store.set(input.id, record);
                return record;
            },
            markDeleted: async (id, at) => {
                const known = store.get(id);
                if (known) store.set(id, { ...known, deletedAt: at });
            },
        },
        servers: { touch: async () => undefined },
        transport: {
            get: async (url) => {
                fetched.push(url);
                return (
                    options.routes[url] ?? { status: 404, contentType: undefined, json: undefined, retryAfter: null }
                );
            },
        },
        policyOf: () => options.policy ?? 'allow',
        now: () => NOW,
    });
    return { directory, store, fetched };
}

const WEBFINGER = 'https://b.example/.well-known/webfinger?resource=acct%3Abob%40b.example';

describe('ほかのサーバーの actor を引く', () => {
    it('初めての actor は WebFinger を往復して、アカウントと id が結び付いていれば覚える', async () => {
        const { directory, store } = setup({ routes: { [BOB]: ap(person()), [WEBFINGER]: jrd(BOB) } });
        const actor = await directory.get(BOB);
        expect(actor).toMatchObject({ id: BOB, account: 'bob@b.example', domain: 'b.example', inbox: `${BOB}/inbox` });
        expect(store.size).toBe(1);
    });

    it('WebFinger が別の actor を指していれば覚えない（ほかの人のアカウントを名乗らせない）', async () => {
        const { directory, store } = setup({
            routes: { [BOB]: ap(person()), [WEBFINGER]: jrd('https://b.example/ap/users/real-bob') },
        });
        expect(await directory.get(BOB)).toBeNull();
        expect(store.size).toBe(0);
    });

    it('取りに行った URL と違う id の文書は使わない（ほかのオリジンの文書で乗っ取らせない）', async () => {
        const { directory } = setup({
            routes: { [BOB]: ap(person('https://evil.example/ap/users/bob')), [WEBFINGER]: jrd(BOB) },
        });
        expect(await directory.get(BOB)).toBeNull();
    });

    it('inbox がほかのオリジンの文書は使わない（このサーバーを使って第三者へ送らせない）', async () => {
        const { directory } = setup({
            routes: { [BOB]: ap(person(BOB, { inbox: 'https://victim.example/inbox' })), [WEBFINGER]: jrd(BOB) },
        });
        expect(await directory.get(BOB)).toBeNull();
    });

    it('Application actor は /ap/actor だけ。アカウントはホスト', async () => {
        const ok = setup({ routes: { 'https://b.example/ap/actor': ap(app()) } });
        expect(await ok.directory.get('https://b.example/ap/actor')).toMatchObject({
            type: 'Application',
            account: 'b.example',
        });
        const elsewhere = setup({
            routes: {
                'https://b.example/ap/users/svc': ap({
                    ...app(),
                    id: 'https://b.example/ap/users/svc',
                    inbox: 'https://b.example/ap/users/svc/inbox',
                    assertionMethod: [
                        {
                            id: 'https://b.example/ap/users/svc#ed25519-1',
                            type: 'Multikey',
                            controller: 'https://b.example/ap/users/svc',
                            publicKeyMultibase: KEY,
                        },
                    ],
                }),
            },
        });
        expect(await elsewhere.directory.get('https://b.example/ap/users/svc')).toBeNull();
    });

    it('410 を返したら、知っている actor に消えた印を付ける', async () => {
        const { directory, store } = setup({ routes: { [BOB]: ap(person()), [WEBFINGER]: jrd(BOB) } });
        await directory.get(BOB);
        const gone = setup({ routes: { [BOB]: ap(undefined, 410) } });
        gone.store.set(BOB, { ...(store.get(BOB) as RemoteActorRecord) });
        expect((await gone.directory.get(BOB, { refresh: true }))?.deletedAt).toEqual(new Date(NOW));
    });

    it('連合しないサーバーには、文書も WebFinger も取りに行かない', async () => {
        const { directory, fetched } = setup({
            routes: { [BOB]: ap(person()), [WEBFINGER]: jrd(BOB) },
            policy: 'block',
        });
        expect(await directory.get(BOB)).toBeNull();
        expect(await directory.byAccount('bob@b.example')).toBeNull();
        expect(fetched).toEqual([]);
    });

    it('このサーバーの人・このサーバーのアカウントは引かない', async () => {
        const { directory, fetched } = setup({ routes: {} });
        expect(await directory.get('https://a.example/ap/users/alice')).toBeNull();
        expect(await directory.byAccount('alice@a.example')).toBeNull();
        expect(fetched).toEqual([]);
    });

    it('アカウントから引く: WebFinger の self が同じホストの actor のときだけ', async () => {
        const ok = setup({ routes: { [WEBFINGER]: jrd(BOB), [BOB]: ap(person()) } });
        expect((await ok.directory.byAccount('@Bob@B.example'))?.id).toBe(BOB);
        const elsewhere = setup({ routes: { [WEBFINGER]: jrd('https://c.example/ap/users/bob') } });
        expect(await elsewhere.directory.byAccount('bob@b.example')).toBeNull();
    });
});
