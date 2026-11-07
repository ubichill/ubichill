/**
 * ホームへの入り方の純粋な判定（`/` を開いたとき・ランチパッドの「ホーム」・部屋に入れなかったとき）。
 */
import type { HomeInstanceResponse, HomeView, Instance } from '@ubichill/shared';

/**
 * `/` へ渡す状態。ホームから入った部屋に入れずに戻ってきたとき。
 * ホームは開くたびに新しい部屋を作るので、自動でまた入ると失敗を繰り返す。
 */
export interface HomeEntryState {
    homeFailed?: boolean;
}

/** 入る部屋へ渡す状態（ロード画面の先出し・お知らせ・ホームから入ったか）。 */
export interface InstanceEntryState {
    worldId?: string;
    worldData?: { thumbnail?: string; displayName?: string };
    notice?: string;
    fromHome?: boolean;
}

/** 部屋に入れなかったあと。stay は自動では動かない（別のタブに切られたとき。戻すとタブ同士で取り合う）。 */
export type FailureAction = { kind: 'stay' } | { kind: 'home'; state: HomeEntryState };

export const FALLBACK_NOTICE = 'ホームのワールドを開けなかったので、既定のワールドに入りました';

export function readHomeEntryState(state: unknown): HomeEntryState {
    if (typeof state !== 'object' || state === null) return {};
    return (state as { homeFailed?: unknown }).homeFailed === true ? { homeFailed: true } : {};
}

export function readInstanceEntryState(state: unknown): InstanceEntryState {
    if (typeof state !== 'object' || state === null) return {};
    const { worldId, worldData, notice, fromHome } = state as Record<string, unknown>;
    const data =
        typeof worldData === 'object' && worldData !== null
            ? (worldData as { thumbnail?: unknown; displayName?: unknown })
            : undefined;
    const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
    return {
        ...(text(worldId) ? { worldId: text(worldId) } : {}),
        ...(data ? { worldData: { thumbnail: text(data.thumbnail), displayName: text(data.displayName) } } : {}),
        ...(text(notice) ? { notice: text(notice) } : {}),
        ...(fromHome === true ? { fromHome: true } : {}),
    };
}

export function instanceEntryState(instance: Instance, notice?: string): InstanceEntryState {
    return {
        worldId: instance.world.id,
        worldData: { thumbnail: instance.world.thumbnail, displayName: instance.world.displayName },
        ...(notice ? { notice } : {}),
    };
}

/** 用意したホームの部屋へ入るときの状態。既定のワールドに切り替えたならお知らせを付ける。 */
export function homeInstanceEntry(response: HomeInstanceResponse): InstanceEntryState {
    const notice = response.fallback === 'unresolvable' ? FALLBACK_NOTICE : undefined;
    return { ...instanceEntryState(response.instance, notice), fromHome: true };
}

/**
 * 部屋に入れなかったあとどうするか。
 * - 別のタブ・端末に切られた: 自動では動かない（ホームへ戻すと、新しい部屋を作っては互いを切り合う）
 * - ホームから入った部屋: ホームへ戻すが、自動ではもう作らない（選んでもらう）
 * - それ以外（共有 URL・無くなった部屋）: ホームへ戻ってそのまま入る
 */
export function afterInstanceFailure(failure: { replaced: boolean }, entry: InstanceEntryState): FailureAction {
    if (failure.replaced) return { kind: 'stay' };
    return { kind: 'home', state: entry.fromHome ? { homeFailed: true } : {} };
}

/** 今いる部屋が自分のホームか（自分が作った・ホームのワールド・ホームの公開範囲）。 */
export function isHomeInstance(
    instance: Pick<Instance, 'leaderId' | 'access'> & { world: { id: string; url?: string } },
    home: Pick<HomeView, 'world' | 'accessType'> | null,
    userId: string | undefined,
): boolean {
    if (!home || !userId) return false;
    return (
        instance.leaderId === userId && instance.access.type === home.accessType && isHomeWorld(instance.world, home)
    );
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
