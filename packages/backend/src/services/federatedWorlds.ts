import type { WorldListItem } from '@ubichill/shared';

/** URL を正規の表記にする（既定のポート・大文字のホストなど）。URL として読めなければ undefined。 */
const canonicalUrl = (url: string): string | undefined => URL.parse(url)?.href;

/**
 * 連合の一覧で取りに行くワールドの候補（純粋）。連合はほかのサーバーのワールドだけを出す。
 * - URL として読めない項目・このサーバー自身のワールド（ピアが連合で受け取って返してきたもの）を除く
 * - URL は正規の表記にそろえ、同じ URL は 1 件にする（先に返したピアのものを残す）
 */
export function federatedCandidates(items: readonly WorldListItem[], selfBaseUrl: string): WorldListItem[] {
    const selfOrigin = URL.parse(selfBaseUrl)?.origin;
    const seen = new Set<string>();
    return items.flatMap((item) => {
        const url = canonicalUrl(item.url);
        if (!url || URL.parse(url)?.origin === selfOrigin || seen.has(url)) return [];
        seen.add(url);
        return [{ ...item, url }];
    });
}

/**
 * 取得して確かめたワールドを、作品の ID（`identity.worldId`）で 1 件にする（純粋）。
 * 同じ署名付きのワールドが別の URL（別名・ミラー）で配られていても、一覧には 1 回だけ出す。先に来たものを残す。
 */
export function uniqueByWorldId(items: readonly WorldListItem[]): WorldListItem[] {
    const seen = new Set<string>();
    return items.filter((item) => {
        const key = item.identity?.status === 'verified' ? item.identity.worldId : `url:${item.url}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
