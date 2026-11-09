import type { RemoteActorRecord } from '@ubichill/db';
import { describe, expect, it } from 'vitest';
import { createFederationIdentity } from './identity';
import { createProfileAnnouncer } from './profileUpdates';

const identity = createFederationIdentity('https://a.example');
const actor = (id: string, sharedInbox: string | null, deletedAt: Date | null = null): RemoteActorRecord => ({
    id,
    account: `${id.split('/').pop()}@${new URL(id).host}`,
    domain: new URL(id).host,
    type: 'Person',
    name: null,
    summary: null,
    icon: null,
    url: null,
    inbox: `${id}/inbox`,
    sharedInbox,
    keys: [],
    features: [],
    fetchedAt: new Date(0),
    deletedAt,
    createdAt: new Date(0),
});

describe('プロフィールの更新を届ける', () => {
    it('同じサーバーのフレンド・フォロワーへは共有の inbox に 1 通、共有の inbox が無ければ個人の inbox、消えた人には送らない', async () => {
        const sent: Array<{ inbox: string; to: unknown; type: unknown }> = [];
        const announce = createProfileAnnouncer({
            identity,
            localActors: { person: async (id) => ({ id: identity.actorUrl(id), type: 'Person', name: 'Alice' }) },
            audienceOf: async () => ['b1', 'b2', 'c1', 'd1'],
            actors: {
                findByIds: async () => [
                    actor('https://b.example/ap/users/1', 'https://b.example/ap/inbox'),
                    actor('https://b.example/ap/users/2', 'https://b.example/ap/inbox'),
                    actor('https://c.example/ap/users/1', null),
                    actor('https://d.example/ap/users/1', 'https://d.example/ap/inbox', new Date()),
                ],
            },
            outbox: {
                send: async (input) =>
                    void sent.push({ inbox: input.to.inbox, to: input.activity.to, type: input.activity.type }),
            },
        });
        expect(await announce('alice')).toBe(2);
        expect(sent).toEqual([
            {
                inbox: 'https://b.example/ap/inbox',
                to: ['https://b.example/ap/users/1', 'https://b.example/ap/users/2'],
                type: 'Update',
            },
            { inbox: 'https://c.example/ap/users/1/inbox', to: ['https://c.example/ap/users/1'], type: 'Update' },
        ]);
    });

    it('このサーバーにいない人なら何も送らない', async () => {
        const announce = createProfileAnnouncer({
            identity,
            localActors: { person: async () => undefined },
            audienceOf: async () => ['b1'],
            actors: { findByIds: async () => [] },
            outbox: { send: async () => Promise.reject(new Error('送らない')) },
        });
        expect(await announce('ghost')).toBe(0);
    });
});
