/**
 * 作者のサーバーの正規の URL が知らせる公開範囲（`Ubichill-World-Visibility`）を確かめて覚える（ネットワークと時計は注入）。
 * - 2xx: ヘッダーのとおり（private 以外はパブリック）。404・410: 無い（消した・名前を変えた）のでパブリック
 * - ほかの失敗（429・5xx・時間切れ・通信の失敗・ドメインごとの上限）: 決められない。前に private と決めていれば private
 *   （いつまでも。閉じる側）、それ以外は unknown（部屋は作らせない）。期限を過ぎた public は使わない（攻撃で確かめられなく
 *   させても、古い public で開かない）
 * 決められた結果は ttlMs の間覚え、同じ URL への同時の問い合わせは 1 回にまとめる。
 */
import type { WorldVisibility } from '@ubichill/shared';
import { setBounded } from '../../utils/boundedMap';

export type CanonicalVisibility = WorldVisibility | 'unknown';

export interface CanonicalVisibilityDeps {
    /** 正規の URL の応答の状態とヘッダーの公開範囲。通信の失敗は例外 */
    head: (url: string) => Promise<{ status: number; visibility: WorldVisibility | undefined }>;
    /** そのドメインへ問い合わせてよいか（回数を使う）。上限なら false */
    tryAcquire: (domain: string) => boolean;
    ttlMs: number;
    max: number;
    now?: () => number;
}

export function createCanonicalVisibility(deps: CanonicalVisibilityDeps) {
    const now = deps.now ?? (() => Date.now());
    const known = new Map<string, { at: number; visibility: WorldVisibility }>();
    const inFlight = new Map<string, Promise<CanonicalVisibility>>();

    const determine = async (url: string, domain: string): Promise<WorldVisibility | undefined> => {
        if (!deps.tryAcquire(domain)) return undefined;
        const response = await deps.head(url).catch(() => undefined);
        if (!response) return undefined;
        if (response.status >= 200 && response.status < 300)
            return response.visibility === 'private' ? 'private' : 'public';
        return response.status === 404 || response.status === 410 ? 'public' : undefined;
    };

    return {
        of(url: string, domain: string): Promise<CanonicalVisibility> {
            const cached = known.get(url);
            if (cached && now() - cached.at < deps.ttlMs) return Promise.resolve(cached.visibility);
            const pending = inFlight.get(url);
            if (pending) return pending;
            const task = determine(url, domain)
                .then((fresh): CanonicalVisibility => {
                    if (!fresh) return known.get(url)?.visibility === 'private' ? 'private' : 'unknown';
                    setBounded(known, url, { at: now(), visibility: fresh }, deps.max);
                    return fresh;
                })
                .finally(() => inFlight.delete(url));
            inFlight.set(url, task);
            return task;
        },
        forget(url: string): void {
            known.delete(url);
        },
    };
}
