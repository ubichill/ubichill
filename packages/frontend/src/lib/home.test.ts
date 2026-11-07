import type { HomeInstanceResponse, Instance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { decideHomeEntry, FALLBACK_NOTICE, instanceInviteUrl, isHomeWorld, readHomeEntryState } from './home';

const instance = (id: string): Instance =>
    ({ id, world: { id: 'cafe', displayName: 'カフェ', thumbnail: 'https://x.example/t.png' } }) as Instance;
const response = (id: string, patch: Partial<HomeInstanceResponse> = {}): HomeInstanceResponse => ({
    instance: instance(id),
    reused: false,
    ...patch,
});

describe('readHomeEntryState', () => {
    it.each([null, undefined, 'i1', 1, {}, { homeFailed: '' }, { homeFailed: 3 }])(
        '形の違う state %j は失敗なしとして扱う',
        (state) => {
            expect(readHomeEntryState(state)).toEqual({});
        },
    );

    it('失敗した部屋の ID を読む', () => {
        expect(readHomeEntryState({ homeFailed: 'i1', other: true })).toEqual({ homeFailed: 'i1' });
    });
});

describe('decideHomeEntry', () => {
    it('普通はそのまま入り、ロード画面にワールドを先出しする', () => {
        expect(decideHomeEntry(response('i1'), {})).toEqual({
            kind: 'enter',
            instanceId: 'i1',
            state: {
                worldId: 'cafe',
                worldData: { thumbnail: 'https://x.example/t.png', displayName: 'カフェ' },
            },
        });
    });

    it('入れなかった部屋がまた返ってきたら自動では入らない（ホーム ⇄ 失敗の繰り返しを止める）', () => {
        expect(decideHomeEntry(response('i1', { reused: true }), { homeFailed: 'i1' })).toEqual({
            kind: 'blocked',
            instanceId: 'i1',
        });
    });

    it('利用者が「もう一度」を選んだら同じ部屋でも入る', () => {
        expect(decideHomeEntry(response('i1'), { homeFailed: 'i1' }, { ignoreFailure: true }).kind).toBe('enter');
    });

    it('別の部屋で失敗して戻ってきたなら、ホームにはそのまま入る', () => {
        expect(decideHomeEntry(response('home'), { homeFailed: 'someone-else' }).kind).toBe('enter');
    });

    it('既定のワールドに切り替えたときはお知らせを付ける', () => {
        const decision = decideHomeEntry(response('i2', { fallback: 'unresolvable' }), {});
        expect(decision.kind === 'enter' && decision.state.notice).toBe(FALLBACK_NOTICE);
    });
});

describe('isHomeWorld', () => {
    const home = { world: { id: 'cafe', url: 'https://a.example/api/v1/worlds/cafe' } } as never;

    it('URL があれば URL で比べる（別サーバーの同じ id のワールドを取り違えない）', () => {
        expect(isHomeWorld({ id: 'cafe', url: 'https://b.example/api/v1/worlds/cafe' }, home)).toBe(false);
        expect(isHomeWorld({ id: 'other', url: 'https://a.example/api/v1/worlds/cafe' }, home)).toBe(true);
    });

    it('URL が無ければ id で比べる', () => {
        expect(isHomeWorld({ id: 'cafe' }, home)).toBe(true);
    });

    it('ホームのワールドを解決できない・未取得なら、どれもホームではない', () => {
        expect(isHomeWorld({ id: 'cafe' }, null)).toBe(false);
        expect(isHomeWorld({ id: 'cafe' }, { world: null })).toBe(false);
    });
});

describe('instanceInviteUrl', () => {
    it('末尾のスラッシュを重ねず、ID を URL 用にする', () => {
        expect(instanceInviteUrl('https://ubichill.example/', 'a/b')).toBe('https://ubichill.example/instance/a%2Fb');
    });
});
