import type { WorldListItem } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { federatedListItems } from './federatedWorlds';

const item = (url: string, id = url): WorldListItem => ({ id, url, displayName: id }) as WorldListItem;
const SELF = 'https://ubichill.com';

describe('federatedListItems', () => {
    it('ほかのサーバーのワールドだけを連合の一覧に載せる', () => {
        const peer = item('https://peer.example/api/v1/authors/bob/worlds/a.yaml');
        expect(federatedListItems([peer], SELF)).toEqual([peer]);
    });

    it('ピアが連合で受け取って返してきた、このサーバー自身のワールドは載せない（ローカルに出ている）', () => {
        const own = item('https://ubichill.com/api/v1/authors/youkan/worlds/a.yaml');
        const ownWithPort = item('https://ubichill.com:443/api/v1/authors/youkan/worlds/b.yaml');
        expect(federatedListItems([own, ownWithPort], SELF)).toEqual([]);
        expect(federatedListItems([own], `${SELF}/`)).toEqual([]);
    });

    it('複数のピアが同じワールドを返したら 1 件にする', () => {
        const a = item('https://peer.example/w.yaml', 'from-a');
        const b = item('https://peer.example/w.yaml', 'from-b');
        expect(federatedListItems([a, b], SELF)).toEqual([a]);
    });

    it('URL として読めない項目は、このサーバーのものとは扱わない（後段の検証で落ちる）', () => {
        const broken = item('not a url');
        expect(federatedListItems([broken], SELF)).toEqual([broken]);
    });
});
