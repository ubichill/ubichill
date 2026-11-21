import { z } from 'zod';

export const TEXT_MAX_LENGTH = 2000;
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export const TEXT_SIZE_RANGE = { min: 8, max: 200 } as const;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB の形で入れてください');

/**
 * `core:text` の data。ワールドに置く文字（看板・説明・案内）。改行はそのまま出す。
 * 背景は色か transparent（文字だけ）。未知キーは拒否する。
 */
export const TextDataSchema = z
    .object({
        text: z.string().max(TEXT_MAX_LENGTH).default(''),
        /** 文字の大きさ（px） */
        size: z.number().min(TEXT_SIZE_RANGE.min).max(TEXT_SIZE_RANGE.max).default(24),
        color: Color.default('#1b2a44'),
        background: z.union([Color, z.literal('transparent')]).default('transparent'),
        align: z.enum(TEXT_ALIGNS).default('left'),
        bold: z.boolean().default(false),
    })
    .strict();
