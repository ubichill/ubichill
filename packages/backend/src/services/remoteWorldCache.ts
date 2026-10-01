/**
 * 外部ワールドの解決結果のキャッシュ（ネットワークと時計を注入できる純粋なロジック）。
 *
 * - 成功は ttlMs の間そのまま返す。
 * - 失敗（取得できない・改竄）も failureTtlMs の間は同じ結果を返し、取得し直さない。
 *   取得できない URL を大量に並べたお気に入りなどで、外部への取得を繰り返し起こされないように。
 * - 同じ URL の同時の解決は 1 回にまとめる。
 * - 取得に失敗しても、以前の成功結果が残っていればそれを返す（ただし改竄を検知したら使い続けない）。
 * - 項目数に上限があり、超えたら古いものから捨てる。
 */
import { setBounded } from '../utils/boundedMap';

export type RemoteResolution<W> =
    | { ok: true; world: W }
    | { ok: false; reason: 'not-found' | 'integrity'; message: string };

export interface RemoteWorldCacheDeps<W> {
    /** 外部からワールドを取得して検証する。失敗したら例外。 */
    load: (url: string) => Promise<W>;
    isIntegrityError: (err: unknown) => err is Error;
    onFailure?: (url: string, err: unknown) => void;
    ttlMs: number;
    /** 結果ごとの有効期限（省略時は ttlMs）。作者をいま確かめられなかった結果などを短くするため。 */
    ttlFor?: (world: W) => number;
    failureTtlMs: number;
    max: number;
    now?: () => number;
}

export function createRemoteWorldCache<W>(deps: RemoteWorldCacheDeps<W>) {
    const now = deps.now ?? Date.now;
    const worlds = new Map<string, { at: number; ttl: number; world: W }>();
    const ttlOf = (world: W) => deps.ttlFor?.(world) ?? deps.ttlMs;
    const failures = new Map<string, { at: number; resolution: RemoteResolution<W> }>();
    const inFlight = new Map<string, Promise<RemoteResolution<W>>>();

    const fetchFresh = async (url: string): Promise<RemoteResolution<W>> => {
        try {
            const world = await deps.load(url);
            failures.delete(url);
            setBounded(worlds, url, { at: now(), ttl: ttlOf(world), world }, deps.max);
            return { ok: true, world };
        } catch (err) {
            deps.onFailure?.(url, err);
            // 改竄を検知したら以前の検証済みの結果でも使い続けない（配信元が侵害されている）
            if (deps.isIntegrityError(err)) {
                worlds.delete(url);
                const resolution: RemoteResolution<W> = { ok: false, reason: 'integrity', message: err.message };
                setBounded(failures, url, { at: now(), resolution }, deps.max);
                return resolution;
            }
            const stale = worlds.get(url);
            const resolution: RemoteResolution<W> = stale
                ? { ok: true, world: stale.world }
                : { ok: false, reason: 'not-found', message: 'World not found' };
            setBounded(failures, url, { at: now(), resolution }, deps.max);
            return resolution;
        }
    };

    return {
        resolve(url: string): Promise<RemoteResolution<W>> {
            const cached = worlds.get(url);
            if (cached && now() - cached.at < cached.ttl) return Promise.resolve({ ok: true, world: cached.world });
            const failed = failures.get(url);
            if (failed && now() - failed.at < deps.failureTtlMs) return Promise.resolve(failed.resolution);
            const pending = inFlight.get(url);
            if (pending) return pending;
            const task = fetchFresh(url).finally(() => inFlight.delete(url));
            inFlight.set(url, task);
            return task;
        },
        /** 成功結果を捨てる（作者の鍵や表示名が変わったとき）。失敗の記録は取得の抑制なので残す。 */
        clearWorlds(): void {
            worlds.clear();
        },
    };
}
