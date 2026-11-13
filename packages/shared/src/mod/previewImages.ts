/**
 * mod の見た目の画像（mod のサムネイル・Component・プレハブの見た目）。
 * 画像は mod の assets/ に置き、manifest の assetIntegrity で hash を固定する（manifest は lock で固定される）。
 * エディタは hash を確かめてから表示するので、公開後に画像だけ差し替えることはできない。
 */

/** 1 枚の上限。一覧に並べるので小さく保つ。 */
export const MAX_PREVIEW_IMAGE_BYTES = 256 * 1024;

const PREVIEW_IMAGE_TYPES: Readonly<Record<string, string>> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    // <img> で出す限り svg の中のスクリプトは動かない
    svg: 'image/svg+xml',
};

/** 画像として扱える拡張子なら MIME を返す。 */
export function previewImageType(path: string): string | null {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
    return (ext && PREVIEW_IMAGE_TYPES[ext]) || null;
}

/** 見た目の画像の参照先（manifest 内のアセットの相対パス）。どれも任意。 */
export interface PreviewImageRefs {
    thumbnail?: string;
    components: Readonly<Record<string, string | undefined>>;
    prefabs: Readonly<Record<string, string | undefined>>;
}

/** manifest から見た目の画像の参照先を集める（純粋）。 */
export function previewImageRefs(manifest: {
    thumbnail?: string;
    components: Readonly<Record<string, { thumbnail?: string }>>;
    prefabs?: Readonly<Record<string, { thumbnail?: string }>>;
}): PreviewImageRefs {
    const pick = (record: Readonly<Record<string, { thumbnail?: string }>>) =>
        Object.fromEntries(
            Object.entries(record).flatMap(([key, value]) => (value.thumbnail ? [[key, value.thumbnail]] : [])),
        );
    return {
        ...(manifest.thumbnail ? { thumbnail: manifest.thumbnail } : {}),
        components: pick(manifest.components),
        prefabs: pick(manifest.prefabs ?? {}),
    };
}

/**
 * build で見た目の画像を確かめる。参照先が assets/ にあり、画像の形式で、上限以下であること。
 * 問題の一覧を返す（空なら問題なし）。
 */
export function previewImageProblems(refs: PreviewImageRefs, assetSizes: Readonly<Record<string, number>>): string[] {
    const all = [
        ...(refs.thumbnail ? [['mod のサムネイル', refs.thumbnail] as const] : []),
        ...Object.entries(refs.components).flatMap(([type, path]) =>
            path ? [[`Component ${type}`, path] as const] : [],
        ),
        ...Object.entries(refs.prefabs).flatMap(([name, path]) => (path ? [[`プレハブ ${name}`, path] as const] : [])),
    ];
    return all.flatMap(([label, path]) => {
        const size = assetSizes[path];
        if (size === undefined) return [`${label} の画像が assets/ にありません: ${path}`];
        if (!previewImageType(path)) return [`${label} の画像は png・jpg・webp・avif・svg にしてください: ${path}`];
        if (size > MAX_PREVIEW_IMAGE_BYTES)
            return [`${label} の画像は ${MAX_PREVIEW_IMAGE_BYTES / 1024} KB までです: ${path}`];
        return [];
    });
}
