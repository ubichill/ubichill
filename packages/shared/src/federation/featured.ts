/**
 * フェディバース（Mastodon・Misskey など）のプロフィールに出す固定ノート（actor の `featured` コレクション）。
 * 本人が書いたノートではなく、プロフィールに載っている公開の情報から作る:
 *
 * - 作ったワールド（署名して公開したもの。新しい順に 2 つ）
 * - 公開している mod（本人の署名付きで配られていると確かめられたもの。新しい順に 2 つ）
 * - お気に入りのワールド（お気に入りの公開範囲がパブリックのときだけ。いちばん新しい 1 つ）
 *
 * ほかの実装は固定ノートを 5 件まで読むので、合わせて 5 件にする。ノートの id は項目ごとに変えず、取りに来られたら返す
 * （Mastodon は id を取り直して確かめる）。
 */
import { AS_CONTEXT } from './protocol';
import { escapeHtml } from './text';

export const FEATURED_LIMITS = { worlds: 2, mods: 2, favorites: 1 } as const;

export const PUBLIC_AUDIENCE = 'https://www.w3.org/ns/activitystreams#Public';

export type FeaturedKind = 'world' | 'mod' | 'favorite';

export interface FeaturedItem {
    kind: FeaturedKind;
    /** ノートの id の末尾（項目ごとに変えない） */
    key: string;
    name: string;
    description: string | null;
    /** サムネイル（https の絶対 URL） */
    image: string | null;
    /** 開くページ（https の絶対 URL） */
    link: string;
    /** mod の版 */
    version?: string;
    /** 作った・公開した・お気に入りにした時刻（ISO 8601） */
    published: string;
}

/** 種類ごとに新しい順へ並べ、上限まで取る（作ったワールド → mod → お気に入りの順）。 */
export function pickFeatured(input: {
    worlds: readonly FeaturedItem[];
    mods: readonly FeaturedItem[];
    favorites: readonly FeaturedItem[];
}): FeaturedItem[] {
    const newest = (items: readonly FeaturedItem[], limit: number) =>
        [...items].sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, limit);
    // 同じワールドを作っていてお気に入りにもしていたら、作ったほうだけ出す
    const ownLinks = new Set(input.worlds.map((w) => w.link));
    return [
        ...newest(input.worlds, FEATURED_LIMITS.worlds),
        ...newest(input.mods, FEATURED_LIMITS.mods),
        ...newest(
            input.favorites.filter((f) => !ownLinks.has(f.link)),
            FEATURED_LIMITS.favorites,
        ),
    ];
}

const HEADINGS: Record<FeaturedKind, string> = {
    world: '作ったワールド',
    mod: '公開している mod',
    favorite: 'お気に入りのワールド',
};

/** ノートの本文（HTML）。名前・説明はエスケープし、リンクは 1 つ。 */
export function featuredNoteContent(item: FeaturedItem): string {
    const title = `${HEADINGS[item.kind]}「${escapeHtml(item.name)}」${item.version ? ` v${escapeHtml(item.version)}` : ''}`;
    const link = escapeHtml(item.link);
    return [
        `<p>${title}</p>`,
        ...(item.description ? [`<p>${escapeHtml(item.description)}</p>`] : []),
        `<p><a href="${link}" rel="nofollow noopener" target="_blank">${link}</a></p>`,
    ].join('');
}

const IMAGE_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
};

/** 画像の種類（拡張子から。分からなければ null で、添付しない）。 */
export function imageMediaType(url: string): string | null {
    const path = url.split(/[?#]/)[0] ?? '';
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
    return IMAGE_TYPES[ext] ?? null;
}

/** 固定ノート 1 つ（公開。宛先は公開とフォロワー）。 */
export function buildFeaturedNote(input: {
    id: string;
    actor: string;
    followers: string;
    item: FeaturedItem;
}): Record<string, unknown> & { id: string } {
    const mediaType = input.item.image ? imageMediaType(input.item.image) : null;
    return {
        '@context': AS_CONTEXT,
        id: input.id,
        type: 'Note',
        attributedTo: input.actor,
        to: [PUBLIC_AUDIENCE],
        cc: [input.followers],
        published: input.item.published,
        content: featuredNoteContent(input.item),
        url: input.item.link,
        ...(input.item.image && mediaType
            ? { attachment: [{ type: 'Document', mediaType, url: input.item.image, name: input.item.name }] }
            : {}),
    };
}

/** actor の `featured`（固定ノートを埋め込んだ OrderedCollection）。 */
export function buildFeaturedCollection(input: {
    id: string;
    notes: ReadonlyArray<Record<string, unknown>>;
}): Record<string, unknown> {
    return {
        '@context': AS_CONTEXT,
        id: input.id,
        type: 'OrderedCollection',
        totalItems: input.notes.length,
        // 埋め込んだノートには @context を重ねない
        orderedItems: input.notes.map(({ '@context': _context, ...note }) => note),
    };
}
