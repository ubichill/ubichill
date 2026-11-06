import { z } from 'zod';

/** UI データの長さの上限（文字数）。ワールドの YAML の上限（100KB）の内に収める。 */
export const UI_MARKUP_MAX_LENGTH = 20_000;

/**
 * `core:ui` の data。ワールド作者が書く HTML 風の UI データ（看板・説明・リンクなど）。
 * Host は許可したタグ・属性だけを描く（mod の UI と同じ規則）。script やイベント属性は動かない。
 */
export const UiDataSchema = z
    .object({
        markup: z.string().max(UI_MARKUP_MAX_LENGTH).default(''),
    })
    .strict();
