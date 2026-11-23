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
const MB = 1024 * 1024;
const GB = 1024 * MB;
/**
 * 1 人が置ける合計の大きさ（作り直した後の WebP で数える）。管理者がコントロールパネルで min〜max の間で変える。
 * 数は数えない（大きさの上限を上げても、数の上限が先に効いて意味がなくなるため）。
 */
export const WORLD_ASSET_QUOTA_BYTES = { default: 200 * MB, min: 10 * MB, max: 10 * GB } as const;
/** コントロールパネルで選べる値 */
export const WORLD_ASSET_QUOTA_PRESETS: readonly number[] = [50, 100, 200, 500, 1024, 2048, 5120, 10240].map(
    (mb) => mb * MB,
);
/** どのワールドにも使われていない画像を、上げて（上げ直して）から何日で消すか（本人が止められる） */
export const WORLD_ASSET_UNUSED_GRACE_DAYS = 7;

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
