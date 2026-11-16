/**
 * グローバルの mod 一覧（フォロー中のサーバーが公開している mod）。
 * 検索語はほかのサーバーへ送らない。各サーバーの公開一覧を検索語なしで取り、期限つきで覚えて、ここで絞る。
 * 一覧は取得先の案内だけで、作者・内容はエディタが追加するときに署名と hash で確かめる。
 */
import { type PackageDescriptor, PackageDescriptorSchema, parseAuthorAccount } from '@ubichill/shared';

/** 1 つのサーバーから読むページ数の上限（カタログの 1 ページは 20 件）。 */
export const PEER_MOD_PAGES = 5;
export const PEER_MOD_TTL_MS = 5 * 60 * 1000;
/** 1 回の検索で返す件数の上限。 */
export const FEDERATED_MOD_LIMIT = 100;

export interface FederatedModCatalogDeps {
    peers: () => Promise<ReadonlyArray<{ baseUrl: string }>>;
    /** ピアのカタログ（`/api/v1/mods?offset=`）の 1 ページ。 */
    fetchPage: (baseUrl: string, offset: number) => Promise<unknown>;
    selfDomain: () => string;
    now?: () => number;
    onError?: (baseUrl: string, error: unknown) => void;
}

/** カタログの 1 ページから、読める項目と次のページを取り出す。壊れた項目は捨てる。 */
export function parseCatalogPage(body: unknown): { items: PackageDescriptor[]; nextOffset: number | null } {
    const page = (typeof body === 'object' && body !== null ? body : {}) as { items?: unknown; nextOffset?: unknown };
    const items = (Array.isArray(page.items) ? page.items : []).flatMap((item) => {
        const parsed = PackageDescriptorSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
    });
    const next = page.nextOffset;
    return { items, nextOffset: typeof next === 'number' && Number.isSafeInteger(next) && next > 0 ? next : null };
}

/** ID・作者・作者参照（`@作者/ID`）の部分一致。大文字小文字は区別しない。 */
export function matchesModQuery(item: PackageDescriptor, query: string): boolean {
    const q = query.trim().toLowerCase();
    return !q || `@${item.author}/${item.id}`.toLowerCase().includes(q);
}

/**
 * 複数のサーバーの一覧を 1 つにする。このサーバーの作者は除き（ローカルに出ている）、
 * 同じ作者・ID は最初に知った 1 件にする。並びは ID・作者の順。
 */
export function mergePeerMods(lists: readonly PackageDescriptor[][], selfDomain: string): PackageDescriptor[] {
    const self = selfDomain.toLowerCase();
    const unique = lists
        .flat()
        .filter((item) => parseAuthorAccount(item.author)?.domain.toLowerCase() !== self)
        .reduce((map, item) => {
            const key = `${item.author}/${item.id}`;
            return map.has(key) ? map : map.set(key, item);
        }, new Map<string, PackageDescriptor>());
    return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id) || a.author.localeCompare(b.author));
}

export function createFederatedModCatalog(deps: FederatedModCatalogDeps) {
    const now = deps.now ?? Date.now;
    const lists = new Map<string, { at: number; items: PackageDescriptor[] }>();
    const running = new Map<string, Promise<PackageDescriptor[]>>();

    const fetchPages = async (baseUrl: string, offset: number, page: number): Promise<PackageDescriptor[]> => {
        const { items, nextOffset } = parseCatalogPage(await deps.fetchPage(baseUrl, offset));
        if (nextOffset === null || nextOffset <= offset || page + 1 >= PEER_MOD_PAGES) return items;
        return [...items, ...(await fetchPages(baseUrl, nextOffset, page + 1))];
    };

    /** 期限内なら覚えた一覧。取れなければ前に取れた一覧を使う（同時の取得は 1 回にまとめる）。 */
    const peerMods = (baseUrl: string): Promise<PackageDescriptor[]> => {
        const cached = lists.get(baseUrl);
        if (cached && now() - cached.at < PEER_MOD_TTL_MS) return Promise.resolve(cached.items);
        const pending = running.get(baseUrl);
        if (pending) return pending;
        const task = fetchPages(baseUrl, 0, 0)
            .then((items) => {
                lists.set(baseUrl, { at: now(), items });
                return items;
            })
            .catch((error: unknown) => {
                deps.onError?.(baseUrl, error);
                return cached?.items ?? [];
            })
            .finally(() => running.delete(baseUrl));
        running.set(baseUrl, task);
        return task;
    };

    return {
        async search(query: string): Promise<{ items: PackageDescriptor[]; nextOffset: null }> {
            const peers = await deps.peers();
            const followed = new Set(peers.map((peer) => peer.baseUrl));
            // フォローを外したサーバーの一覧は覚えておかない
            for (const baseUrl of [...lists.keys()]) if (!followed.has(baseUrl)) lists.delete(baseUrl);
            const results = await Promise.all(peers.map((peer) => peerMods(peer.baseUrl)));
            const items = mergePeerMods(results, deps.selfDomain()).filter((item) =>
                matchesModQuery(item, query.slice(0, 50)),
            );
            return { items: items.slice(0, FEDERATED_MOD_LIMIT), nextOffset: null };
        },
    };
}
