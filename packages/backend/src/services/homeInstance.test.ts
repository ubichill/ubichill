import {
    DEFAULT_HOME_SETTINGS,
    DEFAULT_HOME_WORLD_REF,
    type HomeSettings,
    type Instance,
    type ResolvedWorld,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    createHomeService,
    type HomeCandidate,
    type HomeServiceDeps,
    type HomeTarget,
    pickReusableHomeInstance,
} from './homeInstance';
import type { WorldResolution } from './worldRegistry';

const NOW = 10_000_000;
const EMPTY_TIMEOUT = 5 * 60_000;
const ME = 'me';
const HOME_URL = 'https://ubichill.example/api/v1/worlds/cafe';
const DEFAULT_URL = 'https://ubichill.example/api/v1/worlds/default';

const candidate = (patch: Partial<HomeCandidate> = {}): HomeCandidate => ({
    id: 'i1',
    leaderId: ME,
    worldRef: HOME_URL,
    accessType: 'invite_only',
    contentHash: 'h1',
    maxUsers: 10,
    createdAt: new Date(NOW - 60_000),
    passwordHash: null,
    ...patch,
});
const target: HomeTarget = { leaderId: ME, worldRef: HOME_URL, accessType: 'invite_only', contentHash: 'h1' };
const room = (memberIds: string[] = [], emptySince = NOW - 1000) => ({ memberIds, emptySince });
const timing = { now: NOW, emptyTimeoutMs: EMPTY_TIMEOUT };

describe('pickReusableHomeInstance', () => {
    it('条件が全部そろった自分の部屋を使い回す', () => {
        expect(pickReusableHomeInstance([candidate()], target, new Map([['i1', room()]]), timing)?.id).toBe('i1');
    });

    it.each<[string, Partial<HomeCandidate>]>([
        ['ワールドを更新した（版が違う）', { contentHash: 'h0' }],
        ['版が分からない部屋と分かるワールド', { contentHash: null }],
        ['公開範囲を変えた', { accessType: 'public' }],
        ['別のワールド', { worldRef: DEFAULT_URL }],
        ['他人がリーダー', { leaderId: 'someone' }],
        ['パスワード付き', { passwordHash: 'bcrypt' }],
    ])('%s部屋は使わない', (_label, patch) => {
        expect(pickReusableHomeInstance([candidate(patch)], target, new Map([['i1', room()]]), timing)).toBeUndefined();
    });

    it('DB にだけ残っていて Go に部屋が無いものは使わない（入ると初期状態から作り直しになり、掃除とも競る）', () => {
        expect(pickReusableHomeInstance([candidate()], target, new Map(), timing)).toBeUndefined();
    });

    it('満員の部屋は使わない（自分のホームでも入れない）', () => {
        const full = room(Array.from({ length: 10 }, (_, i) => `u${i}`));
        expect(pickReusableHomeInstance([candidate()], target, new Map([['i1', full]]), timing)).toBeUndefined();
    });

    it('もうすぐ片付けられる空の部屋は使わない（返したあと入る前に消される）', () => {
        const stale = room([], NOW - EMPTY_TIMEOUT + 30_000);
        const old = candidate({ createdAt: new Date(NOW - EMPTY_TIMEOUT * 2) });
        expect(pickReusableHomeInstance([old], target, new Map([['i1', stale]]), timing)).toBeUndefined();
    });

    it('片付けまでが短い環境（dev の 5 秒）でも、できたばかりの空の部屋は使い回す', () => {
        const short = { now: NOW, emptyTimeoutMs: 5000 };
        const fresh = candidate({ createdAt: new Date(NOW - 1000) });
        expect(pickReusableHomeInstance([fresh], target, new Map([['i1', room([], NOW - 1000)]]), short)?.id).toBe(
            'i1',
        );
        const stale = candidate({ createdAt: new Date(NOW - 4000) });
        expect(
            pickReusableHomeInstance([stale], target, new Map([['i1', room([], NOW - 4000)]]), short),
        ).toBeUndefined();
    });

    it('空になって時間が経っていても、誰かいる部屋は使う', () => {
        const occupied = room(['friend'], NOW - EMPTY_TIMEOUT * 10);
        expect(pickReusableHomeInstance([candidate()], target, new Map([['i1', occupied]]), timing)?.id).toBe('i1');
    });

    it('作ったばかりなら、Go の空き時刻が古くても使う（作成直後の猶予）', () => {
        const fresh = candidate({ createdAt: new Date(NOW - 1000) });
        const roomEmptyLong = room([], 0);
        expect(pickReusableHomeInstance([fresh], target, new Map([['i1', roomEmptyLong]]), timing)?.id).toBe('i1');
    });

    it('複数あれば人の多い部屋、同数なら新しい部屋（別の端末から入っても分かれない）', () => {
        const a = candidate({ id: 'a', createdAt: new Date(NOW - 3000) });
        const b = candidate({ id: 'b', createdAt: new Date(NOW - 2000) });
        const c = candidate({ id: 'c', createdAt: new Date(NOW - 1000) });
        const presence = new Map([
            ['a', room(['x'])],
            ['b', room()],
            ['c', room()],
        ]);
        expect(pickReusableHomeInstance([b, c, a], target, presence, timing)?.id).toBe('a');
        expect(pickReusableHomeInstance([b, c], target, presence, timing)?.id).toBe('c');
    });
});

const world = (url: string, hash: string | null = 'h1'): ResolvedWorld =>
    ({ id: url.split('/').pop(), url, displayName: url, identity: hash ? { contentHash: hash } : undefined }) as
        | ResolvedWorld
        | never;

const instanceOf = (id: string, worldUrl: string): Instance => ({ id, world: { id: worldUrl } }) as Instance;

/** メモリの偽物。lock は呼んだ順に 1 つずつ実行する（Postgres の advisory lock と同じく直列）。 */
function fakeDeps(options: { worlds?: Record<string, ResolvedWorld>; home?: HomeSettings } = {}) {
    const worlds = options.worlds ?? {
        [DEFAULT_HOME_WORLD_REF]: world(DEFAULT_URL, 'd1'),
        [DEFAULT_URL]: world(DEFAULT_URL, 'd1'),
        [HOME_URL]: world(HOME_URL),
        '@youkan/cafe': world(HOME_URL),
    };
    const state = {
        home: options.home ?? DEFAULT_HOME_SETTINGS,
        records: [] as HomeCandidate[],
        presence: new Map<string, { memberIds: string[]; emptySince: number }>(),
        created: [] as string[],
        failCreate: false,
    };
    const queue = { tail: Promise.resolve() as Promise<unknown> };
    const deps: HomeServiceDeps = {
        settings: {
            get: async () => state.home,
            set: async (_userId, home) => {
                state.home = home;
            },
            withLock: (_userId, fn) => {
                const run = queue.tail.then(fn, fn);
                queue.tail = run.catch(() => undefined);
                return run;
            },
        },
        worlds: {
            resolve: async (ref): Promise<WorldResolution> => {
                const found = worlds[ref];
                return found
                    ? { ok: true, world: found }
                    : { ok: false, reason: 'not-found', message: `World not found: ${ref}` };
            },
            listItemOf: (w) => ({ id: w.id, displayName: w.displayName, url: w.url }) as never,
        },
        instances: {
            findByLeader: async (userId) => state.records.filter((r) => r.leaderId === userId),
            create: async (worldRef, accessType, leaderId) => {
                // 作成は遅い（Go の部屋を用意する）ので、同時に呼ばれたら重なる
                await new Promise((resolve) => setTimeout(resolve, 5));
                if (state.failCreate) return { error: 'Too many instances' };
                const id = `new${state.created.length + 1}`;
                const hash = Object.values(worlds).find((w) => w.url === worldRef)?.identity?.contentHash ?? null;
                state.records.push(candidate({ id, worldRef, accessType, leaderId, contentHash: hash }));
                state.presence.set(id, room([], NOW));
                state.created.push(id);
                return instanceOf(id, worldRef);
            },
            get: async (id) => {
                const r = state.records.find((x) => x.id === id);
                return r ? instanceOf(r.id, r.worldRef) : undefined;
            },
        },
        presence: async () => state.presence,
        now: () => NOW,
        emptyTimeoutMs: EMPTY_TIMEOUT,
    };
    return { deps, state };
}

describe('createHomeService', () => {
    it('設定が無ければ既定のワールドに招待のみで作る', async () => {
        const { deps, state } = fakeDeps();
        const result = await createHomeService(deps).ensureInstance(ME);
        expect(result).toMatchObject({ ok: true, value: { reused: false } });
        expect(state.records[0]).toMatchObject({ worldRef: DEFAULT_URL, accessType: 'invite_only' });
    });

    it('2 回目は同じ部屋を使い回す（リロードのたびに作らない）', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: HOME_URL, accessType: 'friend_only' } });
        const service = createHomeService(deps);
        await service.ensureInstance(ME);
        const second = await service.ensureInstance(ME);
        expect(second).toMatchObject({ ok: true, value: { reused: true, instance: { id: 'new1' } } });
        expect(state.created).toEqual(['new1']);
    });

    it('同時に開いても（タブ 2 つ）部屋は 1 つ', async () => {
        const { deps, state } = fakeDeps();
        const service = createHomeService(deps);
        const results = await Promise.all([service.ensureInstance(ME), service.ensureInstance(ME)]);
        expect(state.created).toEqual(['new1']);
        expect(results.map((r) => r.ok && r.value.instance.id)).toEqual(['new1', 'new1']);
    });

    it('ホームのワールドが消えていたら既定のワールドで入り、そう伝える', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: 'https://gone.example/w.yaml', accessType: 'public' } });
        const result = await createHomeService(deps).ensureInstance(ME);
        expect(result).toMatchObject({ ok: true, value: { fallback: 'unresolvable' } });
        // 公開範囲は設定のまま
        expect(state.records[0]).toMatchObject({ worldRef: DEFAULT_URL, accessType: 'public' });
    });

    it('既定のワールドも開けなければ 502（画面がホームへ戻し続けないよう失敗を返す）', async () => {
        const { deps, state } = fakeDeps({ worlds: {} });
        expect(await createHomeService(deps).ensureInstance(ME)).toMatchObject({ ok: false, status: 502 });
        expect(state.created).toEqual([]);
    });

    it('useDefault なら設定を無視して既定のワールド（壊れたホームから抜けるため）', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: HOME_URL, accessType: 'invite_only' } });
        const result = await createHomeService(deps).ensureInstance(ME, { useDefault: true });
        expect(result).toMatchObject({ ok: true });
        expect(result.ok && result.value.fallback).toBeUndefined();
        expect(state.records[0]?.worldRef).toBe(DEFAULT_URL);
    });

    it('作成に失敗したら 502 で理由を返す', async () => {
        const { deps, state } = fakeDeps();
        state.failCreate = true;
        expect(await createHomeService(deps).ensureInstance(ME)).toMatchObject({
            ok: false,
            status: 502,
            error: 'Too many instances',
        });
    });

    it('共有 URL で設定しても正規 URL で保存する（部屋の world_ref と比べられるように）', async () => {
        const { deps, state } = fakeDeps();
        const result = await createHomeService(deps).update(ME, { worldRef: '@youkan/cafe' });
        expect(state.home).toEqual({ worldRef: HOME_URL, accessType: 'invite_only' });
        expect(result).toMatchObject({ ok: true, value: { worldRef: HOME_URL, world: { url: HOME_URL } } });
    });

    it('開けないワールドは 400 で、設定を変えない', async () => {
        const before = { worldRef: HOME_URL, accessType: 'public' } as const;
        const { deps, state } = fakeDeps({ home: before });
        const result = await createHomeService(deps).update(ME, {
            worldRef: 'https://nope.example/w.yaml',
            accessType: 'friend_plus',
        });
        expect(result).toMatchObject({ ok: false, status: 400 });
        expect(state.home).toEqual(before);
    });

    it('公開範囲だけ変えるときはワールドを保ち、null で既定に戻す', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: HOME_URL, accessType: 'invite_only' } });
        const service = createHomeService(deps);
        await service.update(ME, { accessType: 'public' });
        expect(state.home).toEqual({ worldRef: HOME_URL, accessType: 'public' });
        const reset = await service.update(ME, { worldRef: null });
        expect(state.home).toEqual({ worldRef: null, accessType: 'public' });
        expect(reset).toMatchObject({ ok: true, value: { world: { url: DEFAULT_URL } } });
    });

    it('公開範囲を変えたら、前の部屋は使わず新しく作る', async () => {
        const { deps, state } = fakeDeps();
        const service = createHomeService(deps);
        await service.ensureInstance(ME);
        await service.update(ME, { accessType: 'public' });
        await service.ensureInstance(ME);
        expect(state.created).toEqual(['new1', 'new2']);
    });
});
