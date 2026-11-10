/**
 * フェディバース（Mastodon・Misskey など）のプロフィールに出す固定ノート（actor の `featured` コレクション）。
 * 本人が書いたノートではなく、プロフィールに載っている公開の情報から、種類ごとに 1 つのノートにまとめて作る:
 *
 * - 作ったワールド（署名して公開したもの）
 * - 公開している mod（本人の署名付きで配られていると確かめられたもの）
 * - お気に入りのワールド（お気に入りの公開範囲がパブリックのときだけ）
 *
 * それぞれ新しい順に {@link FEATURED_ITEMS_PER_NOTE} 件まで並べ、画像は {@link FEATURED_IMAGES_PER_NOTE} 枚まで添付する。
 * 相手は同じ id のノートを取り直さないので、ノートの id は中身から決める（backend）。
 */
import { AS_CONTEXT } from '../protocol';
import { escapeHtml } from './text';

export const FEATURED_ITEMS_PER_NOTE = 10;
/** Mastodon が並べて見せる枚数 */
export const FEATURED_IMAGES_PER_NOTE = 4;

export const PUBLIC_AUDIENCE = 'https://www.w3.org/ns/activitystreams#Public';

export type FeaturedKind = 'world' | 'mod' | 'favorite';

export const FEATURED_KINDS: readonly FeaturedKind[] = ['world', 'mod', 'favorite'];

export interface FeaturedItem {
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

/** 固定ノート 1 つ分（種類と、新しい順の項目。項目が 1 つ以上）。 */
export interface FeaturedGroup {
    kind: FeaturedKind;
    items: FeaturedItem[];
}

/** 種類ごとに新しい順へ並べて上限まで取り、項目のある種類だけ返す（作ったワールド → mod → お気に入りの順）。 */
export function pickFeatured(input: Record<FeaturedKind, readonly FeaturedItem[]>): FeaturedGroup[] {
    // 同じワールドを作っていてお気に入りにもしていたら、作ったほうだけ出す
    const ownLinks = new Set(input.world.map((w) => w.link));
    const candidates: Record<FeaturedKind, readonly FeaturedItem[]> = {
        ...input,
        favorite: input.favorite.filter((f) => !ownLinks.has(f.link)),
    };
    return FEATURED_KINDS.map((kind) => ({
        kind,
        items: [...candidates[kind]]
            .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
            .slice(0, FEATURED_ITEMS_PER_NOTE),
    })).filter((group) => group.items.length > 0);
}

const HEADINGS: Record<FeaturedKind, string> = {
    world: '作ったワールド',
    mod: '公開している mod',
    favorite: 'お気に入りのワールド',
};

const LINK_ATTRS = 'rel="nofollow noopener" target="_blank"';

/** ノートの本文（HTML）。見出しと、項目ごとに名前（リンク）・版・説明。名前・説明はエスケープする。 */
export function featuredNoteContent(group: FeaturedGroup): string {
    const line = (item: FeaturedItem) => {
        const name = `<a href="${escapeHtml(item.link)}" ${LINK_ATTRS}>${escapeHtml(item.name)}</a>`;
        const version = item.version ? ` v${escapeHtml(item.version)}` : '';
        const description = item.description ? `<br>${escapeHtml(item.description)}` : '';
        return `<p>${name}${version}${description}</p>`;
    };
    return [`<p>${HEADINGS[group.kind]}</p>`, ...group.items.map(line)].join('');
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

/** 固定ノート 1 つ（公開。宛先は公開とフォロワー）。時刻はいちばん新しい項目のもの。 */
export function buildFeaturedNote(input: {
    id: string;
    actor: string;
    followers: string;
    group: FeaturedGroup;
}): Record<string, unknown> & { id: string } {
    const images = input.group.items
        .flatMap((item) => {
            const mediaType = item.image ? imageMediaType(item.image) : null;
            return item.image && mediaType ? [{ type: 'Document', mediaType, url: item.image, name: item.name }] : [];
        })
        .slice(0, FEATURED_IMAGES_PER_NOTE);
    return {
        '@context': AS_CONTEXT,
        id: input.id,
        type: 'Note',
        attributedTo: input.actor,
        to: [PUBLIC_AUDIENCE],
        cc: [input.followers],
        published: input.group.items[0]?.published,
        content: featuredNoteContent(input.group),
        ...(images.length > 0 ? { attachment: images } : {}),
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
