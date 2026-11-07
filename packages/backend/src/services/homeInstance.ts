import type { InstanceRecord } from '@ubichill/db';
import {
    type AccessType,
    applyHomeUpdate,
    DEFAULT_HOME_WORLD_REF,
    type HomeInstanceResponse,
    type HomeSettings,
    type HomeSettingsUpdate,
    type HomeView,
    type Instance,
    type ResolvedWorld,
    type WorldListItem,
} from '@ubichill/shared';
import type { RoomPresence } from './instanceRuntime';
import type { WorldResolution } from './worldRegistry';

/**
 * 空の部屋が片付けられる直前のものは使い回さない（返したあと入る前に消されないよう、これだけ余裕を見る）。
 * 片付けまでの時間が短い環境（dev は 5 秒）では、その半分にする（固定の 60 秒では空の部屋を一度も使い回せない）。
 */
export const REUSE_MARGIN_MS = 60_000;

export type HomeCandidate = Pick<
    InstanceRecord,
    'id' | 'leaderId' | 'worldRef' | 'accessType' | 'contentHash' | 'maxUsers' | 'createdAt' | 'passwordHash'
>;

export interface HomeTarget {
    leaderId: string;
    worldRef: string;
    accessType: AccessType;
    contentHash: string | null;
}

/**
 * 使い回してよい自分のホームの部屋を選ぶ。条件:
 * 自分がリーダー・同じワールドの同じ版・同じ公開範囲・パスワード無し・Go に部屋がある・満員でない・すぐ片付けられない。
 * 複数あれば人の多い部屋（同じ人が別の端末から入るときに分かれないように）、同数なら新しい部屋。
 */
export function pickReusableHomeInstance(
    candidates: readonly HomeCandidate[],
    target: HomeTarget,
    presence: ReadonlyMap<string, Pick<RoomPresence, 'memberIds' | 'emptySince'>>,
    timing: { now: number; emptyTimeoutMs: number; marginMs?: number },
): HomeCandidate | undefined {
    const margin = timing.marginMs ?? Math.min(REUSE_MARGIN_MS, timing.emptyTimeoutMs / 2);
    const usable = candidates.filter((c) => {
        const room = presence.get(c.id);
        if (!room) return false;
        if (
            c.leaderId !== target.leaderId ||
            c.worldRef !== target.worldRef ||
            c.accessType !== target.accessType ||
            (c.contentHash ?? null) !== target.contentHash ||
            c.passwordHash !== null
        )
            return false;
        if (room.memberIds.length >= c.maxUsers) return false;
        if (room.memberIds.length > 0) return true;
        const idleSince = Math.max(c.createdAt.getTime(), room.emptySince);
        return timing.now - idleSince < timing.emptyTimeoutMs - margin;
    });
    const members = (c: HomeCandidate) => presence.get(c.id)?.memberIds.length ?? 0;
    return [...usable].sort((a, b) => members(b) - members(a) || b.createdAt.getTime() - a.createdAt.getTime())[0];
}

export interface HomeServiceDeps {
    settings: {
        get(userId: string): Promise<HomeSettings>;
        set(userId: string, home: HomeSettings): Promise<void>;
        withLock<T>(userId: string, fn: () => Promise<T>): Promise<T>;
    };
    worlds: {
        resolve(ref: string): Promise<WorldResolution>;
        listItemOf(world: ResolvedWorld): WorldListItem;
    };
    instances: {
        findByLeader(userId: string): Promise<HomeCandidate[]>;
        create(worldRef: string, accessType: AccessType, leaderId: string): Promise<Instance | { error: string }>;
        get(id: string): Promise<Instance | undefined>;
    };
    presence(): Promise<ReadonlyMap<string, Pick<RoomPresence, 'memberIds' | 'emptySince'>>>;
    now(): number;
    emptyTimeoutMs: number;
}

export type HomeOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 502; error: string };

export interface HomeService {
    view(userId: string): Promise<HomeView>;
    update(userId: string, update: HomeSettingsUpdate): Promise<HomeOutcome<HomeView>>;
    /** ホームの部屋を返す（あれば使い回し、無ければ作る）。useDefault なら設定を無視して既定のワールドで入る。 */
    ensureInstance(userId: string, options?: { useDefault?: boolean }): Promise<HomeOutcome<HomeInstanceResponse>>;
}

export function createHomeService(deps: HomeServiceDeps): HomeService {
    const viewOf = async (home: HomeSettings): Promise<HomeView> => {
        const resolution = await deps.worlds.resolve(home.worldRef ?? DEFAULT_HOME_WORLD_REF);
        return { ...home, world: resolution.ok ? deps.worlds.listItemOf(resolution.world) : null };
    };

    /** 設定のワールドを解決する。開けなければ既定のワールドにし、それも開けなければ失敗。 */
    const resolveTarget = async (
        home: HomeSettings,
        useDefault: boolean,
    ): Promise<{ world: ResolvedWorld; fallback: boolean } | undefined> => {
        const ref = useDefault ? DEFAULT_HOME_WORLD_REF : (home.worldRef ?? DEFAULT_HOME_WORLD_REF);
        const preferred = await deps.worlds.resolve(ref);
        if (preferred.ok) return { world: preferred.world, fallback: false };
        if (ref === DEFAULT_HOME_WORLD_REF) return undefined;
        const fallback = await deps.worlds.resolve(DEFAULT_HOME_WORLD_REF);
        return fallback.ok ? { world: fallback.world, fallback: true } : undefined;
    };

    return {
        async view(userId) {
            return viewOf(await deps.settings.get(userId));
        },

        async update(userId, update) {
            const next = applyHomeUpdate(await deps.settings.get(userId), update);
            if (update.worldRef) {
                const resolution = await deps.worlds.resolve(update.worldRef);
                if (!resolution.ok) return { ok: false, status: 400, error: resolution.message };
                // 貼られた共有ページの URL なども正規 URL にそろえて持つ（部屋の world_ref と比べるため）
                next.worldRef = resolution.world.url;
            }
            await deps.settings.set(userId, next);
            return { ok: true, value: await viewOf(next) };
        },

        async ensureInstance(userId, options) {
            const home = await deps.settings.get(userId);
            const target = await resolveTarget(home, options?.useDefault === true);
            if (!target) return { ok: false, status: 502, error: 'ホームのワールドも既定のワールドも開けません' };
            const { world } = target;
            const accessType = home.accessType;
            const fallback = target.fallback ? { fallback: 'unresolvable' as const } : {};

            return deps.settings.withLock(userId, async (): Promise<HomeOutcome<HomeInstanceResponse>> => {
                const [candidates, presence] = await Promise.all([
                    deps.instances.findByLeader(userId),
                    deps.presence(),
                ]);
                const reusable = pickReusableHomeInstance(
                    candidates,
                    {
                        leaderId: userId,
                        worldRef: world.url,
                        accessType,
                        contentHash: world.identity?.contentHash ?? null,
                    },
                    presence,
                    { now: deps.now(), emptyTimeoutMs: deps.emptyTimeoutMs },
                );
                const existing = reusable ? await deps.instances.get(reusable.id) : undefined;
                if (existing) return { ok: true, value: { instance: existing, reused: true, ...fallback } };

                const created = await deps.instances.create(world.url, accessType, userId);
                if ('error' in created) return { ok: false, status: 502, error: created.error };
                return { ok: true, value: { instance: created, reused: false, ...fallback } };
            });
        },
    };
}
