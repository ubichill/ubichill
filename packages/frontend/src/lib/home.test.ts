import type { HomeInstanceResponse, Instance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    AUTO_HOME_LIMIT,
    afterInstanceFailure,
    canAutoHome,
    FALLBACK_NOTICE,
    homeInstanceEntry,
    instanceInviteUrl,
    isHomeInstance,
    isHomeWorld,
    readAutoHomeLog,
    readHomeEntryState,
    readInstanceEntryState,
    withAutoHome,
} from './home';

const instance = (id: string): Instance =>
    ({ id, world: { id: 'cafe', displayName: 'カフェ', thumbnail: 'https://x.example/t.png' } }) as Instance;
const response = (id: string, patch: Partial<HomeInstanceResponse> = {}): HomeInstanceResponse => ({
    instance: instance(id),
    ...patch,
});

describe('readHomeEntryState', () => {
    it.each([
        null,
        undefined,
        'i1',
        1,
        {},
        { homeFailed: '' },
        { homeFailed: 'i1' },
        { homeFailed: 1 },
        { useDefault: 'yes' },
    ])('形の違う state %j は失敗なしとして扱う（true だけを読む）', (state) => {
        expect(readHomeEntryState(state)).toEqual({});
    });

    it('次は既定のワールドで作るか・もう作らないかを読む（両方あれば止まるほう）', () => {
        expect(readHomeEntryState({ useDefault: true, other: 1 })).toEqual({ useDefault: true });
        expect(readHomeEntryState({ homeFailed: true })).toEqual({ homeFailed: true });
        expect(readHomeEntryState({ homeFailed: true, useDefault: true })).toEqual({ homeFailed: true });
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

    it('ホームから入ったこと・既定のワールドで作ったことを読む', () => {
        expect(readInstanceEntryState({ fromHome: true })).toEqual({ fromHome: true });
        expect(readInstanceEntryState({ fromHome: true, usedDefault: true })).toEqual({
            fromHome: true,
            usedDefault: true,
        });
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

    it('既定のワールドで作ったら（頼んだ・サーバーが切り替えた）お知らせと印を付ける', () => {
        expect(homeInstanceEntry(response('i2', { fallback: 'unresolvable' }))).toMatchObject({
            notice: FALLBACK_NOTICE,
            usedDefault: true,
        });
        expect(homeInstanceEntry(response('i3'), true)).toMatchObject({ notice: FALLBACK_NOTICE, usedDefault: true });
        expect(homeInstanceEntry(response('i4')).usedDefault).toBeUndefined();
    });
});

describe('afterInstanceFailure', () => {
    const failed = (patch: Partial<{ replaced: boolean; gone: boolean }> = {}) => ({
        replaced: false,
        gone: false,
        ...patch,
    });

    it('別のタブに切られたら、ホームから入った部屋でも自動では動かない（タブ同士で部屋を作っては切り合う）', () => {
        expect(afterInstanceFailure(failed({ replaced: true }), { fromHome: true })).toEqual({ kind: 'stay' });
        expect(afterInstanceFailure(failed({ replaced: true, gone: true }), {})).toEqual({ kind: 'stay' });
    });

    it('ホームの部屋が無くなっていたら（ほかのページから戻ってきた）、待たずに新しいホームを作る', () => {
        expect(afterInstanceFailure(failed({ gone: true }), { fromHome: true })).toEqual({
            kind: 'home',
            state: {},
            immediate: true,
        });
        // 既定のワールドで作った部屋でも、無くなっただけなら設定のワールドで作り直す
        expect(afterInstanceFailure(failed({ gone: true }), { fromHome: true, usedDefault: true })).toEqual({
            kind: 'home',
            state: {},
            immediate: true,
        });
    });

    it('ホームで作った部屋に入れなければ、既定のワールドで 1 度だけ作り直し、それも駄目なら止まる', () => {
        expect(afterInstanceFailure(failed(), { fromHome: true })).toEqual({
            kind: 'home',
            state: { useDefault: true },
            immediate: false,
        });
        expect(afterInstanceFailure(failed(), { fromHome: true, usedDefault: true })).toEqual({
            kind: 'home',
            state: { homeFailed: true },
            immediate: false,
        });
    });

    it('共有 URL・ほかの人の部屋は、理由を見せてからホームへ戻ってそのまま入る（無い部屋でも）', () => {
        expect(afterInstanceFailure(failed(), { worldId: 'cafe' })).toEqual({
            kind: 'home',
            state: {},
            immediate: false,
        });
        expect(afterInstanceFailure(failed({ gone: true }), {})).toEqual({ kind: 'home', state: {}, immediate: false });
    });
});

describe('ホームを自動で作る回数', () => {
    const now = 1_000_000;

    it(`${AUTO_HOME_LIMIT.windowMs / 1000} 秒に ${AUTO_HOME_LIMIT.count} 回まで。古い記録は数えず、捨てる`, () => {
        const two = withAutoHome(withAutoHome([], now - 2000), now - 1000);
        expect(canAutoHome(two, now)).toBe(true);
        const three = withAutoHome(two, now);
        expect(canAutoHome(three, now)).toBe(false);
        expect(canAutoHome(three, now + AUTO_HOME_LIMIT.windowMs - 1000)).toBe(true);
        expect(withAutoHome(three, now + AUTO_HOME_LIMIT.windowMs * 2)).toEqual([now + AUTO_HOME_LIMIT.windowMs * 2]);
    });

    it('未来の時刻（時計が戻った）は数えない', () => {
        expect(canAutoHome([now + 10, now + 20, now + 30], now)).toBe(true);
    });

    it('記録が壊れていたら空として扱う', () => {
        expect(readAutoHomeLog(null)).toEqual([]);
        expect(readAutoHomeLog('{')).toEqual([]);
        expect(readAutoHomeLog('{"a":1}')).toEqual([]);
        expect(readAutoHomeLog('[1,"x",2]')).toEqual([1, 2]);
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
