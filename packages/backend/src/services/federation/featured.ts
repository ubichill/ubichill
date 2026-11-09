/**
 * フェディバースのプロフィールに出す固定ノート（`featured`）。選び方とノートの形は shared の federation/featured.ts。
 * ここは材料（作ったワールド・公開している mod・パブリックのお気に入り）を集め、id とリンクを決めて、少しの間覚える。
 *
 * - ノートの id は項目ごとに変えない（種類と項目の id の要約。並びが変わっても同じノート）
 * - 材料の 1 つが取れなくても、ほかの材料で出す（外部の作品の確かめに失敗しても、作ったワールドは出す）
 * - 中身が変わったら（ワールドの公開・お気に入り・公開範囲）、少し待ってまとめて Update{Person} を届ける
 *   （相手は actor を取り直すときに featured も取り直す）
 */
import { createHash } from 'node:crypto';
import {
    buildFeaturedCollection,
    buildFeaturedNote,
    type FavoritesVisibility,
    type FeaturedItem,
    type FeaturedKind,
    pickFeatured,
} from '@ubichill/shared';
import { createTtlCache } from '../../utils/ttlCache';
import type { FederationIdentity } from './identity';

/** 材料 1 つ（path は画面のパスか絶対 URL、image は API のパスか絶対 URL）。 */
export interface FeaturedSource {
    id: string;
    name: string;
    description: string | null;
    image: string | null;
    path: string;
    version?: string;
    published: Date;
}

export interface FeaturedOwner {
    id: string;
    handle: string;
}

export interface FeaturedDeps {
    identity: FederationIdentity;
    /** 画面のオリジン（リンクの先） */
    profileOrigin: string;
    findUser(userId: string): Promise<FeaturedOwner | undefined>;
    sources: {
        worlds(owner: FeaturedOwner): Promise<FeaturedSource[]>;
        mods(owner: FeaturedOwner): Promise<FeaturedSource[]>;
        /** 新しい順のお気に入り（公開範囲は見ない。パブリックのときだけ呼ぶ） */
        favorites(owner: FeaturedOwner): Promise<FeaturedSource[]>;
    };
    favoritesVisibility(userId: string): Promise<FavoritesVisibility>;
    log?: (message: string) => void;
    ttlMs?: number;
}

const PREFIX: Record<FeaturedKind, string> = { world: 'w', mod: 'm', favorite: 'f' };

/** ノートの id の末尾（種類と項目の id の要約。URL に入る文字だけ）。 */
export const featuredKeyOf = (kind: FeaturedKind, id: string): string =>
    `${PREFIX[kind]}-${createHash('sha256').update(`${kind}\n${id}`).digest('base64url').slice(0, 16)}`;

const httpsOnly = (url: string | null, base: string): string | null => {
    if (!url) return null;
    try {
        const absolute = new URL(url, base);
        return absolute.protocol === 'https:' || absolute.protocol === 'http:' ? absolute.href : null;
    } catch {
        return null;
    }
};

export function createFeatured(deps: FeaturedDeps) {
    const cache = createTtlCache<FeaturedItem[]>({ ttlMs: deps.ttlMs ?? 60_000, max: 500 });

    const itemsOf = (kind: FeaturedKind, sources: readonly FeaturedSource[]): FeaturedItem[] =>
        sources.flatMap((s) => {
            const link = httpsOnly(s.path, deps.profileOrigin);
            if (!link) return [];
            return [
                {
                    kind,
                    key: featuredKeyOf(kind, s.id),
                    name: s.name,
                    description: s.description,
                    image: httpsOnly(s.image, deps.identity.origin),
                    link,
                    ...(s.version ? { version: s.version } : {}),
                    published: s.published.toISOString(),
                },
            ];
        });

    const collect = async (owner: FeaturedOwner): Promise<FeaturedItem[]> => {
        const safely = (what: string, load: () => Promise<FeaturedSource[]>) =>
            load().catch((error: unknown) => {
                deps.log?.(`固定ノートの${what}を読めません: ${String(error)}`);
                return [];
            });
        const [worlds, mods, favorites] = await Promise.all([
            safely('ワールド', () => deps.sources.worlds(owner)),
            safely('mod', () => deps.sources.mods(owner)),
            // お気に入りは公開範囲がパブリックのときだけ（フレンドだけ・本人だけなら、ほかのサーバーに出さない）
            safely('お気に入り', async () =>
                (await deps.favoritesVisibility(owner.id)) === 'public' ? deps.sources.favorites(owner) : [],
            ),
        ]);
        return pickFeatured({
            worlds: itemsOf('world', worlds),
            mods: itemsOf('mod', mods),
            favorites: itemsOf('favorite', favorites),
        });
    };

    const items = async (userId: string): Promise<{ owner: FeaturedOwner; items: FeaturedItem[] } | undefined> => {
        const owner = await deps.findUser(userId);
        if (!owner) return undefined;
        return { owner, items: await cache.getOrCreate(owner.id, () => collect(owner)) };
    };

    const noteOf = (owner: FeaturedOwner, item: FeaturedItem) =>
        buildFeaturedNote({
            id: deps.identity.featuredNoteUrl(owner.id, item.key),
            actor: deps.identity.actorUrl(owner.id),
            followers: deps.identity.followersUrl(owner.id),
            item,
        });

    return {
        /** actor の `featured`（ユーザーがいなければ undefined）。 */
        async collection(userId: string): Promise<Record<string, unknown> | undefined> {
            const found = await items(userId);
            if (!found) return undefined;
            return buildFeaturedCollection({
                id: deps.identity.featuredUrl(found.owner.id),
                notes: found.items.map((item) => noteOf(found.owner, item)),
            });
        },

        /** 固定ノート 1 つ（いま固定していなければ undefined）。 */
        async note(userId: string, key: string): Promise<Record<string, unknown> | undefined> {
            const found = await items(userId);
            const item = found?.items.find((i) => i.key === key);
            return found && item ? noteOf(found.owner, item) : undefined;
        },

        /** 中身が変わった（次に取りに来られたら作り直す）。 */
        invalidate(userId: string): void {
            cache.delete(userId);
        },
    };
}

export type Featured = ReturnType<typeof createFeatured>;

/** 同じユーザーの変更をまとめて、少し待ってから 1 度だけ run する（お気に入りを続けて変えても Update を何通も送らない）。 */
export function createDebouncer(run: (userId: string) => void, delayMs: number) {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    return (userId: string): void => {
        const pending = timers.get(userId);
        if (pending) clearTimeout(pending);
        const timer = setTimeout(() => {
            timers.delete(userId);
            run(userId);
        }, delayMs);
        timer.unref?.();
        timers.set(userId, timer);
    };
}
