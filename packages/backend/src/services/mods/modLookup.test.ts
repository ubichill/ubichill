import { MOD_CATALOG_REL, type PackageDescriptor } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createModLookup } from './modLookup';

const SELF = 'ubichill.test';
const remotePen: PackageDescriptor = {
    author: 'bob@peer.test',
    id: 'pen',
    version: '1.4.0',
    baseUrl: 'https://bob.github.io/mods',
};
const finger = (links: unknown[], subject = 'acct:bob@peer.test') => ({ subject, links });
const catalogLink = (href = 'https://peer.test/api/v1/authors/bob/mods') => ({ rel: MOD_CATALOG_REL, href });

/** URL ごとの応答。表に無い URL は 404。値が Error なら通信の失敗。 */
function setup(responses: Record<string, { status: number; body?: unknown } | Error>) {
    const fetched: string[] = [];
    const lookup = createModLookup({
        selfDomain: () => SELF,
        localDescriptor: async (handle, id) =>
            handle === 'alice' && id === 'pen'
                ? { author: `alice@${SELF}`, id, version: '2.3.1', baseUrl: 'https://alice.github.io/mods' }
                : undefined,
        fetchJson: async (url) => {
            fetched.push(url);
            const response = responses[url] ?? { status: 404 };
            if (response instanceof Error) throw response;
            return { status: response.status, body: response.body };
        },
    });
    return { lookup, fetched };
}

const WEBFINGER = 'https://peer.test/.well-known/webfinger?resource=acct%3Abob%40peer.test';
const DESCRIPTOR = 'https://peer.test/api/v1/authors/bob/mods/pen';

describe('createModLookup', () => {
    it('このサーバーの作者は自分のカタログで引き、外へは取りに行かない', async () => {
        const { lookup, fetched } = setup({});
        expect(await lookup({ author: `alice@${SELF}`, id: 'pen' })).toMatchObject({
            status: 'found',
            descriptor: { version: '2.3.1' },
        });
        expect(await lookup({ author: `alice@${SELF}`, id: 'ghost' })).toEqual({ status: 'missing' });
        expect(fetched).toEqual([]);
    });

    it('ほかのサーバーの作者は WebFinger が案内するカタログで引く', async () => {
        const { lookup, fetched } = setup({
            [WEBFINGER]: { status: 200, body: finger([{ rel: 'self', href: 'x' }, catalogLink()]) },
            [DESCRIPTOR]: { status: 200, body: remotePen },
        });
        expect(await lookup({ author: 'bob@peer.test', id: 'pen' })).toEqual({
            status: 'found',
            descriptor: remotePen,
        });
        expect(fetched).toEqual([WEBFINGER, DESCRIPTOR]);
    });

    it('作者・mod が無い（404・410）は missing、届かない（5xx・通信の失敗）は unreachable', async () => {
        expect(await setup({}).lookup({ author: 'bob@peer.test', id: 'pen' })).toEqual({ status: 'missing' });
        expect(await setup({ [WEBFINGER]: { status: 410 } }).lookup({ author: 'bob@peer.test', id: 'pen' })).toEqual({
            status: 'missing',
        });
        expect(await setup({ [WEBFINGER]: { status: 503 } }).lookup({ author: 'bob@peer.test', id: 'pen' })).toEqual({
            status: 'unreachable',
        });
        expect(
            await setup({ [WEBFINGER]: new Error('ECONNREFUSED') }).lookup({ author: 'bob@peer.test', id: 'pen' }),
        ).toEqual({ status: 'unreachable' });
        expect(
            await setup({
                [WEBFINGER]: { status: 200, body: finger([catalogLink()]) },
                [DESCRIPTOR]: { status: 502 },
            }).lookup({ author: 'bob@peer.test', id: 'pen' }),
        ).toEqual({ status: 'unreachable' });
    });

    it('別人の WebFinger・mod を案内しないサーバー・別のオリジンのカタログは missing（取りに行かない）', async () => {
        for (const body of [
            finger([catalogLink()], 'acct:mallory@peer.test'),
            finger([{ rel: 'self', href: 'https://peer.test/users/bob' }]),
            finger([catalogLink('https://evil.test/mods')]),
            finger([catalogLink('https://user:pass@peer.test/mods')]),
            finger([catalogLink('https://peer.test/mods?x=1')]),
            { subject: 'acct:bob@peer.test' },
            'not json object',
        ]) {
            const { lookup, fetched } = setup({ [WEBFINGER]: { status: 200, body } });
            expect(await lookup({ author: 'bob@peer.test', id: 'pen' })).toEqual({ status: 'missing' });
            expect(fetched).toEqual([WEBFINGER]);
        }
    });

    it('カタログが別の作者・別の mod・壊れた形を返したら missing', async () => {
        for (const body of [
            { ...remotePen, author: 'mallory@peer.test' },
            { ...remotePen, id: 'other' },
            { ...remotePen, baseUrl: 'http://bob.github.io/mods' },
            { ...remotePen, version: 'latest' },
            null,
        ]) {
            const { lookup } = setup({
                [WEBFINGER]: { status: 200, body: finger([catalogLink()]) },
                [DESCRIPTOR]: { status: 200, body },
            });
            expect(await lookup({ author: 'bob@peer.test', id: 'pen' })).toEqual({ status: 'missing' });
        }
    });

    it('案内された相対のカタログは作者のオリジンで解決する', async () => {
        const { lookup, fetched } = setup({
            [WEBFINGER]: { status: 200, body: finger([catalogLink('/api/v1/authors/bob/mods/')]) },
            [DESCRIPTOR]: { status: 200, body: remotePen },
        });
        expect((await lookup({ author: 'bob@peer.test', id: 'pen' })).status).toBe('found');
        expect(fetched[1]).toBe(DESCRIPTOR);
    });

    it('作者のアカウントとして読めなければ、取りに行かずに missing', async () => {
        const { lookup, fetched } = setup({});
        expect(await lookup({ author: 'no-domain', id: 'pen' })).toEqual({ status: 'missing' });
        expect(fetched).toEqual([]);
    });

    it('このサーバーの作者のカタログが失敗したら unreachable', async () => {
        const lookup = createModLookup({
            selfDomain: () => SELF,
            localDescriptor: async () => {
                throw new Error('db down');
            },
            fetchJson: async () => ({ status: 404, body: null }),
        });
        expect(await lookup({ author: `alice@${SELF}`, id: 'pen' })).toEqual({ status: 'unreachable' });
    });
});
