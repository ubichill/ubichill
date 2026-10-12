import type { WorldListItem } from '@ubichill/shared';

const originOf = (url: string): string | undefined => URL.parse(url)?.origin;

/**
 * 連合の一覧に載せるワールド（純粋）。連合はほかのサーバーのワールドだけを出す。
 * - このサーバー自身のワールド（ピアが連合で受け取って返してきたもの）は除く。ローカルの一覧に出ている
 * - 複数のピアが同じワールドを返したら 1 件にする（先に返したピアのものを残す）
 */
export function federatedListItems(items: readonly WorldListItem[], selfBaseUrl: string): WorldListItem[] {
    const selfOrigin = originOf(selfBaseUrl);
    const seen = new Set<string>();
    return items.filter((item) => {
        if (originOf(item.url) === selfOrigin || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}
