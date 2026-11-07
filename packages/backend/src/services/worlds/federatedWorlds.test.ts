import type { WorldIdentity, WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { federatedCandidates, uniqueByWorldId } from './federatedWorlds';

const item = (url: string, extra: Partial<WorldListItem> = {}): WorldListItem =>
    ({ id: url, url, displayName: url, ...extra }) as WorldListItem;
const verified = (worldId: string): WorldIdentity => ({
    status: 'verified',
    worldId,
    publicKey: 'K'.repeat(43),
    contentHash: `sha256-${'A'.repeat(43)}=`,
});
const SELF = 'https://ubichill.com';

describe('federatedCandidates', () => {
    it('ほかのサーバーのワールドだけを候補にする', () => {
        const peer = item('https://peer.example/api/v1/authors/bob/worlds/a.yaml');
        expect(federatedCandidates([peer], SELF)).toEqual([peer]);
    });

    it('ピアが連合で受け取って返してきた、このサーバー自身のワールドは候補にしない（ローカルに出ている）', () => {
        const own = item('https://ubichill.com/api/v1/authors/youkan/worlds/a.yaml');
        const ownWithPort = item('https://ubichill.com:443/api/v1/authors/youkan/worlds/b.yaml');
        const ownUpper = item('https://UBICHILL.com/w.yaml');
        expect(federatedCandidates([own, ownWithPort, ownUpper], SELF)).toEqual([]);
        expect(federatedCandidates([own], `${SELF}/`)).toEqual([]);
    });

    it('URL の表記違い（既定のポート・大文字のホスト）は同じ URL として 1 件にし、正規の表記で取りに行く', () => {
        const a = item('https://peer.example/w.yaml', { id: 'from-a' });
        const b = item('https://peer.example:443/w.yaml', { id: 'from-b' });
        const c = item('https://PEER.example/w.yaml', { id: 'from-c' });
        expect(federatedCandidates([a, b, c], SELF)).toEqual([a]);
        expect(federatedCandidates([b], SELF)).toEqual([{ ...b, url: 'https://peer.example/w.yaml' }]);
    });

    it('URL として読めない項目は候補にしない', () => {
        expect(federatedCandidates([item('not a url'), item('')], SELF)).toEqual([]);
    });
});

describe('uniqueByWorldId', () => {
    it('同じ署名付きのワールドが別の URL（ミラー・別名）で来ても 1 件にする', () => {
        const id = 'acct:bob@peer.example/a';
        const original = item('https://peer.example/a.yaml', { identity: verified(id) });
        const mirror = item('https://mirror.example/a.yaml', { identity: verified(id) });
        const other = item('https://peer.example/b.yaml', { identity: verified('acct:bob@peer.example/b') });
        expect(uniqueByWorldId([original, mirror, other])).toEqual([original, other]);
    });

    it('識別の無い項目は URL で区別する（別のワールドを 1 つにまとめない）', () => {
        const a = item('https://peer.example/a.yaml');
        const b = item('https://peer.example/b.yaml');
        expect(uniqueByWorldId([a, b, a])).toEqual([a, b]);
    });
});
