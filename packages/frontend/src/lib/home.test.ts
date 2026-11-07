import type { HomeInstanceResponse, Instance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    afterInstanceFailure,
    FALLBACK_NOTICE,
    homeInstanceEntry,
    instanceInviteUrl,
    isHomeInstance,
    isHomeWorld,
    readHomeEntryState,
    readInstanceEntryState,
} from './home';

const instance = (id: string): Instance =>
    ({ id, world: { id: 'cafe', displayName: 'カフェ', thumbnail: 'https://x.example/t.png' } }) as Instance;
const response = (id: string, patch: Partial<HomeInstanceResponse> = {}): HomeInstanceResponse => ({
    instance: instance(id),
    ...patch,
});

describe('readHomeEntryState', () => {
    it.each([null, undefined, 'i1', 1, {}, { homeFailed: '' }, { homeFailed: 'i1' }, { homeFailed: 1 }])(
        '形の違う state %j は失敗なしとして扱う（true だけを失敗とみなす）',
        (state) => {
            expect(readHomeEntryState(state)).toEqual({});
        },
    );

    it('ホームの部屋に入れなかったことを読む', () => {
        expect(readHomeEntryState({ homeFailed: true, other: 1 })).toEqual({ homeFailed: true });
    });
});

describe('readInstanceEntryState', () => {
    it('履歴に残った state は形を確かめて読み、知らない値は捨てる', () => {
        expect(
            readInstanceEntryState({
                worldId: 'cafe',
                worldData: { displayName: 'カフェ', thumbnail: 3 },
                notice: '',
                fromHome: 'yes',
                extra: true,
            }),
        ).toEqual({ worldId: 'cafe', worldData: { displayName: 'カフェ', thumbnail: undefined } });
    });

    it.each([null, 'x', 0])('state が %j なら何も無い', (state) => {
        expect(readInstanceEntryState(state)).toEqual({});
    });

    it('ホームから入ったことを読む', () => {
        expect(readInstanceEntryState({ fromHome: true })).toEqual({ fromHome: true });
    });
});

describe('homeInstanceEntry', () => {
    it('ホームから入った印と、ロード画面に先出しするワールドを付ける', () => {
        expect(homeInstanceEntry(response('i1'))).toEqual({
            worldId: 'cafe',
            worldData: { thumbnail: 'https://x.example/t.png', displayName: 'カフェ' },
            fromHome: true,
        });
    });

    it('既定のワールドに切り替えたときはお知らせを付ける', () => {
        expect(homeInstanceEntry(response('i2', { fallback: 'unresolvable' })).notice).toBe(FALLBACK_NOTICE);
    });
});

describe('afterInstanceFailure', () => {
    it('別のタブに切られたら、ホームから入った部屋でも自動では動かない（タブ同士で部屋を作っては切り合う）', () => {
        expect(afterInstanceFailure({ replaced: true }, { fromHome: true })).toEqual({ kind: 'stay' });
        expect(afterInstanceFailure({ replaced: true }, {})).toEqual({ kind: 'stay' });
    });

    it('ホームから入った部屋で失敗したら、ホームでは自動で作り直さない', () => {
        expect(afterInstanceFailure({ replaced: false }, { fromHome: true })).toEqual({
            kind: 'home',
            state: { homeFailed: true },
        });
    });

    it('共有 URL・無くなった部屋で失敗したら、ホームへ戻ってそのまま入る', () => {
        expect(afterInstanceFailure({ replaced: false }, { worldId: 'cafe' })).toEqual({ kind: 'home', state: {} });
    });
});

describe('isHomeInstance', () => {
    const home = {
        world: { id: 'cafe', url: 'https://a.example/api/v1/worlds/cafe' },
        accessType: 'invite_only',
    } as never;
    const room = (patch: Record<string, unknown> = {}) =>
        ({
            leaderId: 'me',
            access: { type: 'invite_only' },
            world: { id: 'cafe', url: 'https://a.example/api/v1/worlds/cafe' },
            ...patch,
        }) as never;

    it('自分が作った・ホームのワールド・ホームの公開範囲なら、ホーム', () => {
        expect(isHomeInstance(room(), home, 'me')).toBe(true);
    });

    it('どれか 1 つでも違えばホームではない（ほかの人の部屋・公開範囲を変えた後の古い部屋）', () => {
        expect(isHomeInstance(room({ leaderId: 'friend' }), home, 'me')).toBe(false);
        expect(isHomeInstance(room({ access: { type: 'public' } }), home, 'me')).toBe(false);
        expect(
            isHomeInstance(room({ world: { id: 'cafe', url: 'https://b.example/api/v1/worlds/cafe' } }), home, 'me'),
        ).toBe(false);
    });

    it('ホームの設定やログインがまだ分からなければ、ホームとはみなさない', () => {
        expect(isHomeInstance(room(), null, 'me')).toBe(false);
        expect(isHomeInstance(room(), home, undefined)).toBe(false);
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
