/**
 * ホームへの入り方の純粋な判定（`/` を開いたとき・ランチパッドの「ホーム」・部屋に入れなかったとき）。
 */
import type { HomeInstanceResponse, HomeView, Instance } from '@ubichill/shared';

/**
 * `/` へ渡す状態。部屋に入れずに戻ってきたとき。
 * - useDefault: 次は既定のワールドで作る
 * - homeFailed: 既定のワールドの部屋にも入れなかった。自動ではもう作らない
 * - retryPath: 入れなかった共有 URL などの部屋（ホームに入ったあと「もう一度試す」で戻れる）
 */
export interface HomeEntryState {
    useDefault?: boolean;
    homeFailed?: boolean;
    retryPath?: string;
}

/** 入る部屋へ渡す状態（ロード画面の先出し・お知らせ・ホームから入ったか・既定のワールドで作ったか・入れなかった部屋）。 */
export interface InstanceEntryState {
    worldId?: string;
    worldData?: { thumbnail?: string; displayName?: string };
    notice?: string;
    fromHome?: boolean;
    usedDefault?: boolean;
    retryPath?: string;
}

/**
 * 部屋に入れなかったあと。stay は自動では動かない（別のタブに切られたとき。戻すとタブ同士で取り合う）。
 * immediate はすぐ戻す（理由を読ませなくてよいとき）。autoHomeFailed は自動で用意したホームに入れなかった（続けて失敗した数に足す）。
 */
export type FailureAction =
    | { kind: 'stay' }
    | { kind: 'home'; state: HomeEntryState; immediate: boolean; autoHomeFailed: boolean };

export const FALLBACK_NOTICE = 'ホームのワールドを開けなかったので、既定のワールドに入りました';

/** もう一度試す先は部屋の URL（`/instance/:id`）だけ受け付ける（履歴の state から任意の場所へ飛ばさない）。 */
const readRetryPath = (v: unknown): string | undefined =>
    typeof v === 'string' && /^\/instance\/[^/?#\\]+(\?[^#]*)?$/.test(v) ? v : undefined;

const withRetryPath = (retryPath: string | undefined) => (retryPath ? { retryPath } : {});

export function readHomeEntryState(state: unknown): HomeEntryState {
    if (typeof state !== 'object' || state === null) return {};
    const { useDefault, homeFailed, retryPath } = state as Record<string, unknown>;
    const retry = withRetryPath(readRetryPath(retryPath));
    if (homeFailed === true) return { homeFailed: true, ...retry };
    return { ...(useDefault === true ? { useDefault: true } : {}), ...retry };
}

export function readInstanceEntryState(state: unknown): InstanceEntryState {
    if (typeof state !== 'object' || state === null) return {};
    const { worldId, worldData, notice, fromHome, usedDefault, retryPath } = state as Record<string, unknown>;
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
        ...withRetryPath(readRetryPath(retryPath)),
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
 * 入れなかった部屋があれば引き継ぐ（ホームに入ったあと、そこへ戻る導線を出す）。
 */
export function homeInstanceEntry(
    response: HomeInstanceResponse,
    request: Pick<HomeEntryState, 'useDefault' | 'retryPath'> = {},
): InstanceEntryState {
    const usedDefault = request.useDefault === true || response.fallback === 'unresolvable';
    return {
        ...instanceEntryState(response.instance, usedDefault ? FALLBACK_NOTICE : undefined),
        fromHome: true,
        ...(usedDefault ? { usedDefault: true } : {}),
        ...withRetryPath(readRetryPath(request.retryPath)),
    };
}

/**
 * 部屋に入れなかったあとどうするか。path は入れなかった部屋の URL。
 * - 別のタブ・端末に切られた: 自動では動かない（ホームへ戻すと、新しい部屋を作っては互いを切り合う）
 * - 共有 URL・ほかの人の部屋: 理由を見せてからホームへ戻り、ホームを作って入る。元の部屋へ戻る導線を残す
 * - ホームで作った部屋が無い（閉じた部屋に履歴から戻った）: すぐ新しいホームを作って入る
 * - ホームで作った部屋に入れない: 既定のワールドで 1 度だけ作り直し、それも駄目なら自動ではもう作らない
 */
export function afterInstanceFailure(
    failure: { replaced: boolean; gone: boolean },
    entry: InstanceEntryState,
    path: string,
): FailureAction {
    if (failure.replaced) return { kind: 'stay' };
    if (!entry.fromHome)
        return {
            kind: 'home',
            state: withRetryPath(readRetryPath(path)),
            immediate: false,
            autoHomeFailed: false,
        };
    const retry = withRetryPath(entry.retryPath);
    if (failure.gone) return { kind: 'home', state: retry, immediate: true, autoHomeFailed: true };
    return {
        kind: 'home',
        state: { ...(entry.usedDefault ? { homeFailed: true } : { useDefault: true }), ...retry },
        immediate: false,
        autoHomeFailed: true,
    };
}

/**
 * 自動で用意したホームに続けてこの回数入れなければ、自動ではもう作らない。
 * 正常に続けて失敗しうるのは「閉じたホーム → ホームのワールドで作り直し → 既定のワールドで作り直し」の 3 回までで、
 * 3 回目は homeFailed で止まる。それより先へ進むのは、作っても入れない状態が続いているとき。
 */
export const AUTO_HOME_MAX_FAILURES = 3;

/** 部屋に入れた（どの部屋でも）か、自動で用意したホームに入れなかったか。 */
export type EntryOutcome = 'entered' | 'autoHomeFailed';

/** 続けて失敗した数。入れたら 0 に戻すので、何度ホームへ戻っても入れている限り止まらない。 */
export const nextHomeFailures = (failures: number, outcome: EntryOutcome): number =>
    outcome === 'entered' ? 0 : failures + 1;

export const canAutoHome = (failures: number): boolean => failures < AUTO_HOME_MAX_FAILURES;

/** 記録の読み出し（壊れていれば 0。数え直しになるだけで、多くても {@link AUTO_HOME_MAX_FAILURES} 回で止まる）。 */
export function parseHomeFailures(raw: string | null): number {
    return raw !== null && /^\d{1,6}$/.test(raw) ? Number(raw) : 0;
}

/** 続けて失敗した数の記録先（sessionStorage 互換。タブごとに数える）。 */
export interface HomeFailureStore {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

const HOME_FAILURES_KEY = 'ubichill:home-failures';

export const readHomeFailures = (store: HomeFailureStore): number =>
    parseHomeFailures(store.getItem(HOME_FAILURES_KEY));

export function recordEntryOutcome(store: HomeFailureStore, outcome: EntryOutcome): void {
    store.setItem(HOME_FAILURES_KEY, String(nextHomeFailures(readHomeFailures(store), outcome)));
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
