import type { HomeInstanceResponse, Instance } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    AUTO_HOME_MAX_FAILURES,
    afterInstanceFailure,
    canAutoHome,
    type EntryOutcome,
    FALLBACK_NOTICE,
    type HomeFailureStore,
    homeInstanceEntry,
    instanceInviteUrl,
    isHomeInstance,
    isHomeWorld,
    nextHomeFailures,
    parseHomeFailures,
    readHomeEntryState,
    readHomeFailures,
    readInstanceEntryState,
    recordEntryOutcome,
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

    it('入れなかった部屋は、止まっていても引き継ぐ', () => {
        expect(readHomeEntryState({ retryPath: '/instance/i1' })).toEqual({ retryPath: '/instance/i1' });
        expect(readHomeEntryState({ homeFailed: true, retryPath: '/instance/i1?name=a' })).toEqual({
            homeFailed: true,
            retryPath: '/instance/i1?name=a',
        });
    });

    it.each([
        'https://evil.example/instance/i1',
        '//evil.example/instance/i1',
        '/instance/',
        '/instance/i1/../../auth',
        '/instance/i1#x',
        '/instance/a\\b',
        '/world/cafe',
        'instance/i1',
        1,
    ])('部屋の URL でない %j は、もう一度試す先として受け付けない', (retryPath) => {
        expect(readHomeEntryState({ retryPath })).toEqual({});
        expect(readInstanceEntryState({ retryPath })).toEqual({});
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
        expect(readInstanceEntryState({ retryPath: '/instance/i1' })).toEqual({ retryPath: '/instance/i1' });
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
        expect(homeInstanceEntry(response('i3'), { useDefault: true })).toMatchObject({
            notice: FALLBACK_NOTICE,
            usedDefault: true,
        });
        expect(homeInstanceEntry(response('i4')).usedDefault).toBeUndefined();
    });

    it('入れなかった部屋を引き継ぐ（部屋の URL でなければ捨てる）', () => {
        expect(homeInstanceEntry(response('i1'), { retryPath: '/instance/x' }).retryPath).toBe('/instance/x');
        expect(homeInstanceEntry(response('i1'), { retryPath: '/auth' })).not.toHaveProperty('retryPath');
    });
});

describe('afterInstanceFailure', () => {
    const failed = (patch: Partial<{ replaced: boolean; gone: boolean }> = {}) => ({
        replaced: false,
        gone: false,
        ...patch,
    });
    const here = '/instance/here';

    it('別のタブに切られたら、ホームから入った部屋でも自動では動かない（タブ同士で部屋を作っては切り合う）', () => {
        expect(afterInstanceFailure(failed({ replaced: true }), { fromHome: true }, here)).toEqual({ kind: 'stay' });
        expect(afterInstanceFailure(failed({ replaced: true, gone: true }), {}, here)).toEqual({ kind: 'stay' });
    });

    it('ホームの部屋が無くなっていたら（ほかのページから戻ってきた）、待たずに新しいホームを作る。戻る導線は出さない', () => {
        expect(afterInstanceFailure(failed({ gone: true }), { fromHome: true }, here)).toEqual({
            kind: 'home',
            state: {},
            immediate: true,
            autoHomeFailed: true,
        });
        // 既定のワールドで作った部屋でも、無くなっただけなら設定のワールドで作り直す
        expect(afterInstanceFailure(failed({ gone: true }), { fromHome: true, usedDefault: true }, here)).toEqual({
            kind: 'home',
            state: {},
            immediate: true,
            autoHomeFailed: true,
        });
    });

    it('ホームで作った部屋に入れなければ、既定のワールドで 1 度だけ作り直し、それも駄目なら止まる', () => {
        expect(afterInstanceFailure(failed(), { fromHome: true }, here)).toEqual({
            kind: 'home',
            state: { useDefault: true },
            immediate: false,
            autoHomeFailed: true,
        });
        expect(afterInstanceFailure(failed(), { fromHome: true, usedDefault: true }, here)).toEqual({
            kind: 'home',
            state: { homeFailed: true },
            immediate: false,
            autoHomeFailed: true,
        });
    });

    it('共有 URL・ほかの人の部屋は、理由を見せてからホームへ戻り、その部屋へ戻る導線を渡す（無い部屋でも）', () => {
        expect(afterInstanceFailure(failed(), { worldId: 'cafe' }, '/instance/i1?name=a')).toEqual({
            kind: 'home',
            state: { retryPath: '/instance/i1?name=a' },
            immediate: false,
            autoHomeFailed: false,
        });
        expect(afterInstanceFailure(failed({ gone: true }), {}, here)).toEqual({
            kind: 'home',
            state: { retryPath: here },
            immediate: false,
            autoHomeFailed: false,
        });
    });

    it('共有 URL のあとのホームにも入れなければ、元の部屋への導線をそのまま引き継ぐ（自分のホームの URL では上書きしない）', () => {
        const entry = { fromHome: true, retryPath: '/instance/shared' };
        expect(afterInstanceFailure(failed({ gone: true }), entry, here)).toMatchObject({
            state: { retryPath: '/instance/shared' },
        });
        expect(afterInstanceFailure(failed(), { ...entry, usedDefault: true }, here)).toMatchObject({
            state: { homeFailed: true, retryPath: '/instance/shared' },
        });
    });
});

describe('続けて入れなかった数', () => {
    const memoryStore = (initial: Record<string, string> = {}): HomeFailureStore & { data: Map<string, string> } => {
        const data = new Map(Object.entries(initial));
        return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    };
    const play = (store: HomeFailureStore, outcomes: readonly EntryOutcome[]) => {
        for (const outcome of outcomes) recordEntryOutcome(store, outcome);
    };

    it('入れたら 0 に戻る。何度ホームへ戻って入り直しても止まらない', () => {
        const store = memoryStore();
        // 閉じたホームに戻る → 新しいホームに入れた、を 100 回
        play(store, Array.from({ length: 100 }, (): EntryOutcome[] => ['autoHomeFailed', 'entered']).flat());
        expect(readHomeFailures(store)).toBe(0);
        expect(canAutoHome(readHomeFailures(store))).toBe(true);
    });

    it(`入れたことが無いまま ${AUTO_HOME_MAX_FAILURES} 回続けば止まる（間隔に関係なく。時刻は数えない）`, () => {
        const store = memoryStore();
        play(
            store,
            Array.from({ length: AUTO_HOME_MAX_FAILURES - 1 }, (): EntryOutcome => 'autoHomeFailed'),
        );
        expect(canAutoHome(readHomeFailures(store))).toBe(true);
        recordEntryOutcome(store, 'autoHomeFailed');
        expect(canAutoHome(readHomeFailures(store))).toBe(false);
        // 止まったあとに手で試して失敗しても、止まったまま
        recordEntryOutcome(store, 'autoHomeFailed');
        expect(canAutoHome(readHomeFailures(store))).toBe(false);
    });

    it('間に 1 回でも入れたら数え直す（止まる直前でも）', () => {
        const store = memoryStore();
        play(store, ['autoHomeFailed', 'autoHomeFailed', 'entered', 'autoHomeFailed', 'autoHomeFailed']);
        expect(readHomeFailures(store)).toBe(2);
        expect(canAutoHome(readHomeFailures(store))).toBe(true);
    });

    it('止まったあとでも、入れたら自動に戻る', () => {
        const store = memoryStore();
        play(store, ['autoHomeFailed', 'autoHomeFailed', 'autoHomeFailed', 'autoHomeFailed', 'entered']);
        expect(canAutoHome(readHomeFailures(store))).toBe(true);
    });

    it('閉じたホーム → ホームのワールド → 既定のワールドの順の作り直しは、数では止めない（3 回目は homeFailed が止める）', () => {
        expect(canAutoHome(nextHomeFailures(nextHomeFailures(0, 'autoHomeFailed'), 'autoHomeFailed'))).toBe(true);
    });

    it.each([null, '', '-1', '1.5', 'NaN', 'Infinity', '1e3', ' 2', '0x3', '[1,2,3]', '9999999'])(
        '記録が壊れていたら %j は 0 として扱う',
        (raw) => {
            expect(parseHomeFailures(raw)).toBe(0);
        },
    );

    it('壊れた記録から数え始めても、上限で止まる', () => {
        const store = memoryStore({ 'ubichill:home-failures': 'garbage' });
        play(
            store,
            Array.from({ length: AUTO_HOME_MAX_FAILURES }, (): EntryOutcome => 'autoHomeFailed'),
        );
        expect(canAutoHome(readHomeFailures(store))).toBe(false);
    });

    it('前の形式（作った時刻の配列）の記録は読まない', () => {
        expect(readHomeFailures(memoryStore({ 'ubichill:home-created': '[1,2,3]' }))).toBe(0);
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
