/**
 * ホームへの入り方の純粋な判定（`/` を開いたとき・ランチパッドの「ホーム」・部屋に入れなかったとき）。
 */
import type { HomeInstanceResponse, HomeView, Instance } from '@ubichill/shared';

/** `/` へ渡す状態。部屋に入れずにホームへ戻すとき、どの部屋で失敗したかを渡す（同じ部屋へ戻し続けないため）。 */
export interface HomeEntryState {
    homeFailed?: string;
}

/** 入る部屋へ渡す状態（ロード画面の先出しとお知らせ）。 */
export interface InstanceEntryState {
    worldId?: string;
    worldData?: { thumbnail?: string; displayName?: string };
    notice?: string;
}

export type HomeEntryDecision =
    | { kind: 'enter'; instanceId: string; state: InstanceEntryState }
    /** 直前に入れなかった部屋がまた返ってきた。自動では入らず、利用者に選んでもらう */
    | { kind: 'blocked'; instanceId: string };

export const FALLBACK_NOTICE = 'ホームのワールドを開けなかったので、既定のワールドに入りました';

export function readHomeEntryState(state: unknown): HomeEntryState {
    if (typeof state !== 'object' || state === null) return {};
    const failed = (state as { homeFailed?: unknown }).homeFailed;
    return typeof failed === 'string' && failed !== '' ? { homeFailed: failed } : {};
}

export function instanceEntryState(instance: Instance, notice?: string): InstanceEntryState {
    return {
        worldId: instance.world.id,
        worldData: { thumbnail: instance.world.thumbnail, displayName: instance.world.displayName },
        ...(notice ? { notice } : {}),
    };
}

/**
 * ホームの部屋が返ってきたときにどうするか。
 * ignoreFailure は利用者が「もう一度試す」を選んだとき（同じ部屋でも入る）。
 */
export function decideHomeEntry(
    response: HomeInstanceResponse,
    entry: HomeEntryState,
    options: { ignoreFailure?: boolean } = {},
): HomeEntryDecision {
    const { instance } = response;
    if (!options.ignoreFailure && entry.homeFailed === instance.id) return { kind: 'blocked', instanceId: instance.id };
    const notice = response.fallback === 'unresolvable' ? FALLBACK_NOTICE : undefined;
    return { kind: 'enter', instanceId: instance.id, state: instanceEntryState(instance, notice) };
}

/** このワールドが今のホームか（正規 URL があれば URL で、無ければ id で比べる）。 */
export function isHomeWorld(world: { id: string; url?: string }, home: Pick<HomeView, 'world'> | null): boolean {
    const homeWorld = home?.world;
    if (!homeWorld) return false;
    if (world.url && homeWorld.url) return world.url === homeWorld.url;
    return world.id === homeWorld.id;
}

/** 招待用の URL（招待のみの部屋は、この URL を渡した人だけが入れる）。 */
export function instanceInviteUrl(origin: string, instanceId: string): string {
    return `${origin.replace(/\/+$/, '')}/instance/${encodeURIComponent(instanceId)}`;
}
