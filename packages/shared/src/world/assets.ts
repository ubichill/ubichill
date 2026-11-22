/**
 * ワールドの画像（作者がこのサーバーに上げ、core:image・背景に使う）。中身のハッシュで URL を決め、同じ URL の中身は変わらない。
 */

export const WORLD_ASSET_CONTENT_TYPE = 'image/webp';
/** 送ってよい大きさ */
export const WORLD_ASSET_MAX_BYTES = 10 * 1024 * 1024;
/** 展開してよい画素数（ヘッダを偽った画像も止める） */
export const WORLD_ASSET_MAX_PIXELS = 40_000_000;
/** 長い辺をこれ以下に縮める（小さい画像は大きくしない） */
export const WORLD_ASSET_MAX_EDGE = 2048;
/** 1 人が置ける数と合計の大きさ（作り直した後の WebP で数える） */
export const WORLD_ASSET_QUOTA = { count: 200, bytes: 200 * 1024 * 1024 } as const;

/** 配信するパス（`PUBLIC_BASE_URL` の後ろに付ける） */
export const worldAssetPath = (hash: string): string => `/api/v1/assets/${hash}.webp`;

/**
 * 文字列（ワールドの定義）の中で画像を指している部分を探す正規表現（Postgres と JS の両方で同じ意味）。1 つ目の括弧がハッシュ。
 * 使われていない画像の掃除が使う。{@link worldAssetPath} の形を変えたらこれも変える（合わないと、使われている画像を消す）。
 */
export const WORLD_ASSET_REFERENCE_PATTERN = '([A-Za-z0-9_-]{43})\\.webp';

/** `<hash>.webp` からハッシュ（SHA-256 の base64url）を取り出す。形が違えば null。 */
export function worldAssetHashOf(file: string): string | null {
    const match = /^([A-Za-z0-9_-]{43})\.webp$/.exec(file);
    return match?.[1] ?? null;
}

/** 上げた画像 */
export interface WorldAsset {
    hash: string;
    url: string;
    width: number;
    height: number;
    bytes: number;
    createdAt: string;
}

/** 上げた画像の一覧と、使っている量 */
export interface WorldAssetList {
    assets: WorldAsset[];
    usage: { count: number; bytes: number };
    quota: typeof WORLD_ASSET_QUOTA;
}
