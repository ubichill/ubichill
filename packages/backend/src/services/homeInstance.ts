import {
    type AccessType,
    DEFAULT_HOME_WORLD_REF,
    type HomeInstanceResponse,
    type HomeSettings,
    type HomeSettingsUpdate,
    type HomeView,
    type Instance,
    type ResolvedWorld,
    type WorldListItem,
} from '@ubichill/shared';
import type { WorldResolution } from './worldRegistry';

export interface HomeServiceDeps {
    settings: {
        get(userId: string): Promise<HomeSettings>;
        /** 渡した項目だけ変え、変えた後の設定を返す */
        update(userId: string, changes: Partial<HomeSettings>): Promise<HomeSettings>;
    };
    worlds: {
        resolve(ref: string): Promise<WorldResolution>;
        listItemOf(world: ResolvedWorld): WorldListItem;
    };
    instances: {
        create(worldRef: string, accessType: AccessType, leaderId: string): Promise<Instance | { error: string }>;
    };
}

export type HomeOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 502; error: string };

export interface HomeService {
    view(userId: string): Promise<HomeView>;
    update(userId: string, update: HomeSettingsUpdate): Promise<HomeOutcome<HomeView>>;
    /**
     * ホームの部屋を新しく作る（使い回さない。ホームは一人で入る場所で、前の部屋は空になれば片付く）。
     * useDefault なら設定を無視して既定のワールドで入る。
     */
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
            const resolution = update.worldRef ? await deps.worlds.resolve(update.worldRef) : undefined;
            if (resolution && !resolution.ok) return { ok: false, status: 400, error: resolution.message };
            const saved = await deps.settings.update(userId, {
                // 貼られた共有ページの URL なども正規 URL にそろえて持つ（今いる部屋がホームかを URL で比べるため）
                ...(update.worldRef !== undefined ? { worldRef: resolution ? resolution.world.url : null } : {}),
                ...(update.accessType !== undefined ? { accessType: update.accessType } : {}),
            });
            return { ok: true, value: await viewOf(saved) };
        },

        async ensureInstance(userId, options) {
            const home = await deps.settings.get(userId);
            const target = await resolveTarget(home, options?.useDefault === true);
            if (!target) return { ok: false, status: 502, error: 'ホームのワールドも既定のワールドも開けません' };
            const created = await deps.instances.create(target.world.url, home.accessType, userId);
            if ('error' in created) return { ok: false, status: 502, error: created.error };
            return { ok: true, value: { instance: created, ...(target.fallback ? { fallback: 'unresolvable' } : {}) } };
        },
    };
}
