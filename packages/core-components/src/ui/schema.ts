import { z } from 'zod';
import { TEXT_ALIGNS, TEXT_MAX_LENGTH, TEXT_SIZE_RANGE } from '../text/schema.js';

/** UI データの長さの上限（文字数）。ワールドの YAML の上限（100KB）の内に収める。 */
export const UI_MARKUP_MAX_LENGTH = 20_000;
/** 角丸の上限（px）。大きくすれば丸・角の丸い帯になる */
export const UI_RADIUS_MAX = 1000;
/** 枠線の太さの上限（px） */
export const UI_BORDER_WIDTH_MAX = 20;

const Color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB の形で入れてください');
const ColorOrNone = z.union([Color, z.literal('transparent')]);

/**
 * `core:ui` の data。Entity の大きさの四角（塗り・枠線・角丸）に、テキストを入れられる（FigJam の図形と同じ考え方）。
 * `button` にすると押せるようになり、同じ Entity のスクリプト（ワープ・スイッチ・ポータル）が押したときに動く。
 * `markup` は上級者向けの HTML 風の UI データで、mod の UI と同じ規則で描く（script やイベント属性は動かない）。
 * 既定はどれも「描かない」（塗りなし・枠なし・角丸なし・テキストなし）。前の版の core:ui（markup だけ）の見た目を変えない。
 */
export const UiDataSchema = z
    .object({
        text: z.string().max(TEXT_MAX_LENGTH).default(''),
        /** テキストの大きさ（px） */
        size: z.number().min(TEXT_SIZE_RANGE.min).max(TEXT_SIZE_RANGE.max).default(24),
        color: Color.default('#1b2a44'),
        align: z.enum(TEXT_ALIGNS).default('center'),
        bold: z.boolean().default(false),
        fill: ColorOrNone.default('transparent'),
        border: ColorOrNone.default('transparent'),
        borderWidth: z.number().min(0).max(UI_BORDER_WIDTH_MAX).default(2),
        radius: z.number().min(0).max(UI_RADIUS_MAX).default(0),
        button: z.boolean().default(false),
        markup: z.string().max(UI_MARKUP_MAX_LENGTH).default(''),
    })
    .strict();
