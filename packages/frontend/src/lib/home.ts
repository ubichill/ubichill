/**
 * ホームへの入り方の純粋な判定（`/` を開いたとき・ランチパッドの「ホーム」・部屋に入れなかったとき）。
 */
import type { HomeInstanceResponse, HomeView, Instance } from '@ubichill/shared';

/**
 * `/` へ渡す状態。ホームで作った部屋に入れずに戻ってきたとき。
 * - useDefault: 次は既定のワールドで作る
 * - homeFailed: 既定のワールドの部屋にも入れなかった。自動ではもう作らない
 */
export interface HomeEntryState {
    useDefault?: boolean;
    homeFailed?: boolean;
}

/** 入る部屋へ渡す状態（ロード画面の先出し・お知らせ・ホームから入ったか・既定のワールドで作ったか）。 */
export interface InstanceEntryState {
    worldId?: string;
    worldData?: { thumbnail?: string; displayName?: string };
    notice?: string;
    fromHome?: boolean;
    usedDefault?: boolean;
}

/**
 * 部屋に入れなかったあと。stay は自動では動かない（別のタブに切られたとき。戻すとタブ同士で取り合う）。
 * immediate はすぐ戻す（理由を読ませなくてよいとき）。
 */
export type FailureAction = { kind: 'stay' } | { kind: 'home'; state: HomeEntryState; immediate: boolean };

export const FALLBACK_NOTICE = 'ホームのワールドを開けなかったので、既定のワールドに入りました';

export function readHomeEntryState(state: unknown): HomeEntryState {
    if (typeof state !== 'object' || state === null) return {};
    const { useDefault, homeFailed } = state as Record<string, unknown>;
    if (homeFailed === true) return { homeFailed: true };
    return useDefault === true ? { useDefault: true } : {};
}

export function readInstanceEntryState(state: unknown): InstanceEntryState {
    if (typeof state !== 'object' || state === null) return {};
    const { worldId, worldData, notice, fromHome, usedDefault } = state as Record<string, unknown>;
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
        ...(usedDefault === true ? { usedDefault: true } : {}),
    };
}

export function instanceEntryState(instance: Instance, notice?: string): InstanceEntryState {
    return {
        worldId: instance.world.id,
        worldData: { thumbnail: instance.world.thumbnail, displayName: instance.world.displayName },
        ...(notice ? { notice } : {}),
    };
}

/**
 * 用意したホームの部屋へ入るときの状態。既定のワールドで作ったなら（頼んだ・サーバーがそうした）お知らせを付ける。
 */
export function homeInstanceEntry(response: HomeInstanceResponse, requestedDefault = false): InstanceEntryState {
    const usedDefault = requestedDefault || response.fallback === 'unresolvable';
    return {
        ...instanceEntryState(response.instance, usedDefault ? FALLBACK_NOTICE : undefined),
        fromHome: true,
        ...(usedDefault ? { usedDefault: true } : {}),
    };
}

/**
 * 部屋に入れなかったあとどうするか。
 * - 別のタブ・端末に切られた: 自動では動かない（ホームへ戻すと、新しい部屋を作っては互いを切り合う）
 * - 共有 URL・ほかの人の部屋: 理由を見せてからホームへ戻り、ホームを作って入る
 * - ホームで作った部屋が無い（閉じた部屋に履歴から戻った）: すぐ新しいホームを作って入る
 * - ホームで作った部屋に入れない: 既定のワールドで 1 度だけ作り直し、それも駄目なら自動ではもう作らない
 */
export function afterInstanceFailure(
    failure: { replaced: boolean; gone: boolean },
    entry: InstanceEntryState,
): FailureAction {
    if (failure.replaced) return { kind: 'stay' };
    if (!entry.fromHome) return { kind: 'home', state: {}, immediate: false };
    if (failure.gone) return { kind: 'home', state: {}, immediate: true };
    return { kind: 'home', state: entry.usedDefault ? { homeFailed: true } : { useDefault: true }, immediate: false };
}

/** ホームを自動で作るのは、この時間に {@link AUTO_HOME_LIMIT.count} 回まで（作っては入れないのを繰り返さない）。 */
export const AUTO_HOME_LIMIT = { count: 3, windowMs: 60_000 } as const;

const recentAutoHomes = (log: readonly number[], now: number): number[] =>
    log.filter((at) => at <= now && now - at < AUTO_HOME_LIMIT.windowMs);

/** 作った時刻の記録から、今また自動で作ってよいか。 */
export const canAutoHome = (log: readonly number[], now: number): boolean =>
    recentAutoHomes(log, now).length < AUTO_HOME_LIMIT.count;

/** 作った時刻の記録に今回を足す（古いものは捨てる）。 */
export const withAutoHome = (log: readonly number[], now: number): number[] => [...recentAutoHomes(log, now), now];

/** 記録の読み出し（壊れていれば空）。 */
export function readAutoHomeLog(raw: string | null): number[] {
    try {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : [];
    } catch {
        return [];
    }
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
