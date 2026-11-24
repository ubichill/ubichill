/**
 * サーバーのブランディング（コントロールパネルの「ブランディング」）: アイコン・紹介のページのバナー・テーマの色・略称。
 * どれも公開する（紹介のページ・タブのアイコン・PWA・OGP）。決めていないものは null で、既定の見た目を使う。
 */
import { z } from 'zod';
import { normalizeHexColor, themeColorProblem } from './themeColor';

export const SERVER_BRANDING_LIMITS = { shortName: 16 } as const;

export const SERVER_IMAGE_KINDS = ['icon', 'banner'] as const;
export type ServerImageKind = (typeof SERVER_IMAGE_KINDS)[number];

export const isServerImageKind = (value: unknown): value is ServerImageKind =>
    typeof value === 'string' && (SERVER_IMAGE_KINDS as readonly string[]).includes(value);

interface ServerImageVariantSpec {
    kind: ServerImageKind;
    width: number;
    height: number;
    format: 'png' | 'webp';
    /** 透明な部分を塗る（iOS のホーム画面は透明を黒で塗るため） */
    opaque?: true;
}

/**
 * 送られた画像から作る画像。アイコンは正方形に切り抜き、使う場所ごとの大きさの PNG にする
 * （Safari は WebP の favicon を出せず、PWA の manifest・iOS のホーム画面も PNG を前提にする）。
 * バナーは OGP の推奨（1.91:1）に切り抜いた WebP（プロフィール画像・ワールドのサムネイルと同じ）。
 */
export const SERVER_IMAGE_VARIANTS = {
    favicon: { kind: 'icon', width: 32, height: 32, format: 'png' },
    'apple-touch-icon': { kind: 'icon', width: 180, height: 180, format: 'png', opaque: true },
    'icon-192': { kind: 'icon', width: 192, height: 192, format: 'png' },
    'icon-512': { kind: 'icon', width: 512, height: 512, format: 'png' },
    banner: { kind: 'banner', width: 1200, height: 630, format: 'webp' },
} as const satisfies Record<string, ServerImageVariantSpec>;

export type ServerImageVariant = keyof typeof SERVER_IMAGE_VARIANTS;

export const isServerImageVariant = (value: unknown): value is ServerImageVariant =>
    typeof value === 'string' && Object.hasOwn(SERVER_IMAGE_VARIANTS, value);

/** その種類の画像から作るもの */
export const serverImageVariantsOf = (kind: ServerImageKind): ServerImageVariant[] =>
    (Object.keys(SERVER_IMAGE_VARIANTS) as ServerImageVariant[]).filter(
        (variant) => SERVER_IMAGE_VARIANTS[variant].kind === kind,
    );

export const serverImageContentType = (variant: ServerImageVariant): string =>
    `image/${SERVER_IMAGE_VARIANTS[variant].format}`;

/** 配信する URL のパス（`PUBLIC_BASE_URL` の後ろに付ける）。中身のハッシュ入り。 */
export const serverImagePath = (variant: ServerImageVariant, hash: string): string =>
    `/api/v1/server/images/${variant}/${hash}.${SERVER_IMAGE_VARIANTS[variant].format}`;

const HASH = /^[A-Za-z0-9_-]{43}$/;

/** URL の最後の部分（`<hash>.png` など）からハッシュを取り出す。形・拡張子が違えば null。 */
export function serverImageHashOf(variant: ServerImageVariant, fileName: string): string | null {
    const suffix = `.${SERVER_IMAGE_VARIANTS[variant].format}`;
    if (!fileName.endsWith(suffix)) return null;
    const hash = fileName.slice(0, -suffix.length);
    return HASH.test(hash) ? hash : null;
}

export interface ServerIconUrls {
    /** ブラウザーのタブ（32px の PNG） */
    favicon: string;
    /** iOS のホーム画面（180px の PNG。透明な部分は塗ってある） */
    appleTouchIcon: string;
    /** PWA・画面に出す小さいアイコン（192px の PNG） */
    icon192: string;
    /** PWA・OGP・JSON-LD（512px の PNG） */
    icon512: string;
}

/** `GET /api/v1/server` の branding。URL は絶対 URL。 */
export interface ServerBranding {
    /** 狭い場所（ホーム画面のアイコンの名前・ワールドのページの見出し）に出す名前。null はサーバー名 */
    shortName: string | null;
    /** 主な色（`#rrggbb`）。null は既定の色 */
    themeColor: string | null;
    icon: ServerIconUrls | null;
    /** 紹介のページのバナー（1200×630 の WebP） */
    banner: string | null;
}

export const DEFAULT_SERVER_BRANDING: ServerBranding = { shortName: null, themeColor: null, icon: null, banner: null };

/** 置いてある画像（種類とハッシュ）から URL を組み立てる。アイコンは作るものが全部そろっているときだけ出す。 */
export function serverBrandingImages(
    images: ReadonlyArray<{ variant: string; hash: string }>,
    publicBaseUrl: string,
): Pick<ServerBranding, 'icon' | 'banner'> {
    const base = publicBaseUrl.replace(/\/+$/, '');
    const urls = new Map(
        images.flatMap(({ variant, hash }) =>
            isServerImageVariant(variant) ? [[variant, `${base}${serverImagePath(variant, hash)}`] as const] : [],
        ),
    );
    const favicon = urls.get('favicon');
    const appleTouchIcon = urls.get('apple-touch-icon');
    const icon192 = urls.get('icon-192');
    const icon512 = urls.get('icon-512');
    return {
        icon: favicon && appleTouchIcon && icon192 && icon512 ? { favicon, appleTouchIcon, icon192, icon512 } : null,
        banner: urls.get('banner') ?? null,
    };
}

/** 略称とテーマの色（`PUT /api/v1/admin/branding`）。空は null（決めていない）。 */
export const ServerBrandingUpdateSchema = z.object({
    shortName: z
        .string()
        .trim()
        .max(SERVER_BRANDING_LIMITS.shortName, `略称は ${SERVER_BRANDING_LIMITS.shortName} 文字までにしてください`)
        .nullable()
        .transform((value) => (value ? value : null)),
    themeColor: z
        .string()
        .trim()
        .nullable()
        .superRefine((value, ctx) => {
            const problem = value ? themeColorProblem(value) : null;
            if (problem) ctx.addIssue({ code: 'custom', message: problem });
        })
        .transform((value) => (value ? normalizeHexColor(value) : null)),
});

export type ServerBrandingUpdateInput = z.input<typeof ServerBrandingUpdateSchema>;
export type ServerBrandingUpdate = z.output<typeof ServerBrandingUpdateSchema>;
