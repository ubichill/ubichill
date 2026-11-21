import { z } from 'zod';

/** 画像を枠にどう収めるか。contain は全体を見せ、cover は枠を埋めて端を切り、fill は縦横を枠に合わせて伸ばす。 */
export const IMAGE_FITS = ['contain', 'cover', 'fill'] as const;

export const IMAGE_SRC_MAX_LENGTH = 2048;
export const IMAGE_ALT_MAX_LENGTH = 200;

const HttpUrl = z.url({ protocol: /^https?$/ });

/**
 * `core:image` の data。ワールドに置く画像（絵・写真・看板の絵など）。src は http(s) の URL
 * （このサーバーに上げた画像か、外のサイトの画像）。空なら何も描かない（エディタで置いた直後）。未知キーは拒否する。
 */
export const ImageDataSchema = z
    .object({
        src: z
            .string()
            .trim()
            .max(IMAGE_SRC_MAX_LENGTH)
            .refine((value) => value === '' || HttpUrl.safeParse(value).success, 'http(s) の URL を入れてください')
            .default(''),
        fit: z.enum(IMAGE_FITS).default('contain'),
        /** 画像の説明（読み上げ・読み込めないときに出す） */
        alt: z.string().max(IMAGE_ALT_MAX_LENGTH).default(''),
    })
    .strict();
