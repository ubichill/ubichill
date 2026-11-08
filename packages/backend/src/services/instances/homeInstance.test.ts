import {
    type AccessType,
    DEFAULT_HOME_SETTINGS,
    DEFAULT_HOME_WORLD_REF,
    type HomeSettings,
    type Instance,
    type ResolvedWorld,
} from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import type { WorldResolution } from '../worlds/worldRegistry';
import { createHomeService, type HomeServiceDeps } from './homeInstance';

const ME = 'me';
const HOME_URL = 'https://ubichill.example/api/v1/worlds/cafe';
const DEFAULT_URL = 'https://ubichill.example/api/v1/worlds/default';

const world = (url: string, hash: string | null = 'h1'): ResolvedWorld =>
    ({ id: url.split('/').pop(), url, displayName: url, identity: hash ? { contentHash: hash } : undefined }) as
        | ResolvedWorld
        | never;

const instanceOf = (id: string, worldUrl: string): Instance => ({ id, world: { id: worldUrl } }) as Instance;

/** メモリの偽物。作った部屋を順に記録する。 */
function fakeDeps(options: { worlds?: Record<string, ResolvedWorld>; home?: HomeSettings } = {}) {
    const worlds = options.worlds ?? {
        [DEFAULT_HOME_WORLD_REF]: world(DEFAULT_URL, 'd1'),
        [DEFAULT_URL]: world(DEFAULT_URL, 'd1'),
        [HOME_URL]: world(HOME_URL),
        '@youkan/cafe': world(HOME_URL),
    };
    const state = {
        home: options.home ?? DEFAULT_HOME_SETTINGS,
        created: [] as Array<{ id: string; worldRef: string; accessType: AccessType; leaderId: string }>,
        failCreate: false,
        /** ワールドの書き込みを待たせる（解決に時間がかかった） */
        worldWriteGate: undefined as Promise<void> | undefined,
    };
    const deps: HomeServiceDeps = {
        settings: {
            get: async () => state.home,
            update: async (_userId, changes) => {
                if (changes.worldRef !== undefined) await state.worldWriteGate;
                state.home = { ...state.home, ...changes };
                return state.home;
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
            create: async (worldRef, accessType, leaderId) => {
                if (state.failCreate) return { error: 'Too many instances' };
                const id = `new${state.created.length + 1}`;
                state.created.push({ id, worldRef, accessType, leaderId });
                return instanceOf(id, worldRef);
            },
        },
    };
    return { deps, state };
}

describe('createHomeService', () => {
    it('設定が無ければ既定のワールドに招待のみで、自分をリーダーにして作る', async () => {
        const { deps, state } = fakeDeps();
        const result = await createHomeService(deps).ensureInstance(ME);
        expect(result).toMatchObject({ ok: true, value: { instance: { id: 'new1' } } });
        expect(result.ok && result.value.fallback).toBeUndefined();
        expect(state.created).toEqual([{ id: 'new1', worldRef: DEFAULT_URL, accessType: 'invite_only', leaderId: ME }]);
    });

    it('呼ぶたびに新しい部屋を作る（前の部屋に人がいても入らない。ホームは一人の場所）', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: HOME_URL, accessType: 'friend_only' } });
        const service = createHomeService(deps);
        const results = await Promise.all([service.ensureInstance(ME), service.ensureInstance(ME)]);
        const third = await service.ensureInstance(ME);
        const ids = [...results, third].map((r) => (r.ok ? r.value.instance.id : null));
        expect(new Set(ids).size).toBe(3);
        expect(state.created.every((c) => c.worldRef === HOME_URL && c.accessType === 'friend_only')).toBe(true);
    });

    it('ホームのワールドが消えていたら既定のワールドで入り、そう伝える', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: 'https://gone.example/w.yaml', accessType: 'public' } });
        const result = await createHomeService(deps).ensureInstance(ME);
        expect(result).toMatchObject({ ok: true, value: { fallback: 'unresolvable' } });
        // 公開範囲は設定のまま
        expect(state.created[0]).toMatchObject({ worldRef: DEFAULT_URL, accessType: 'public' });
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
        expect(state.created[0]?.worldRef).toBe(DEFAULT_URL);
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

    it('共有 URL で設定しても正規 URL で保存する（今いる部屋がホームかを URL で比べられるように）', async () => {
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

    it('ワールドを変えている間に公開範囲を変えても、公開範囲は戻らない', async () => {
        const { deps, state } = fakeDeps({ home: { worldRef: null, accessType: 'public' } });
        const service = createHomeService(deps);
        const slow = Promise.withResolvers<void>();
        state.worldWriteGate = slow.promise;
        const changingWorld = service.update(ME, { worldRef: '@youkan/cafe' });
        await service.update(ME, { accessType: 'invite_only' });
        slow.resolve();
        await changingWorld;
        expect(state.home).toEqual({ worldRef: HOME_URL, accessType: 'invite_only' });
    });

    it('公開範囲を変えたら、次に作る部屋から使われる', async () => {
        const { deps, state } = fakeDeps();
        const service = createHomeService(deps);
        await service.ensureInstance(ME);
        await service.update(ME, { accessType: 'public' });
        await service.ensureInstance(ME);
        expect(state.created.map((c) => c.accessType)).toEqual(['invite_only', 'public']);
    });
});
