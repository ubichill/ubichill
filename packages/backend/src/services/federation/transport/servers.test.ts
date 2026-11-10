import type { RemoteServerRecord } from '@ubichill/db';
import { FEDERATION_FEATURES } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createServerDirectory } from './servers';
import type { FederationResponse } from './transport';

const NOW = Date.parse('2026-11-08T00:00:00Z');
const json = (body: unknown): FederationResponse => ({
    status: 200,
    contentType: 'application/json',
    json: body,
    retryAfter: null,
});
const LINKS = {
    links: [
        { rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: 'https://b.example/nodeinfo/2.1' },
        { rel: 'https://www.w3.org/ns/activitystreams#Application', href: 'https://b.example/ap/actor' },
    ],
};

function setup(appFeatures: () => Promise<string[] | null>) {
    const records = new Map<string, RemoteServerRecord>();
    const servers = createServerDirectory({
        allowHttp: false,
        repo: {
            get: async (domain) => records.get(domain),
            list: async () => [...records.values()],
            setInfo: async (domain, info, now) =>
                void records.set(domain, {
                    ...(records.get(domain) ?? ({ domain } as RemoteServerRecord)),
                    ...info,
                    nodeInfoFetchedAt: now,
                }),
            recordSuccess: async () => undefined,
            recordFailure: async () => 1,
        },
        transport: {
            get: async (url) =>
                url.endsWith('/.well-known/nodeinfo')
                    ? json(LINKS)
                    : json({ software: { name: 'ubichill', version: '1' }, metadata: { federationVersion: 1 } }),
        },
        appFeatures,
        now: () => NOW,
    });
    return { servers, records };
}

describe('相手のサーバーの機能', () => {
    it('告知を読めたうえで載っていない機能だけを「持たない」とする', async () => {
        const { servers } = setup(async () => [FEDERATION_FEATURES.friends]);
        expect(await servers.lacks('b.example', FEDERATION_FEATURES.friends)).toBe(false);
        expect(await servers.lacks('b.example', FEDERATION_FEATURES.invites)).toBe(true);
    });

    it('Application actor を読めなかったときは、機能が無いと記録しない（一時的な失敗で送るのをやめない）', async () => {
        const { servers, records } = setup(async () => null);
        expect(await servers.lacks('b.example', FEDERATION_FEATURES.invites)).toBe(false);
        expect(records.has('b.example')).toBe(false);
    });
});
