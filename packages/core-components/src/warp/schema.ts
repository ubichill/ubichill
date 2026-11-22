import { z } from 'zod';
import { EntityIdRef } from '../entityRef.js';

export const WARP_LABEL_MAX_LENGTH = 60;

/**
 * `core:warp` の data。押すと、行き先の Entity が画面の中心に来るようにスクロールする（ワールドの中で見る場所を変えるだけ）。
 * 行き先が空なら押せない（エディタで置いた直後）。
 */
export const WarpDataSchema = z
    .object({
        target: EntityIdRef.default(''),
        /** ボタンに出す文字（空なら「ワープ」）。UI のボタンで動かすときは、ボタンの読み上げに使う */
        label: z.string().max(WARP_LABEL_MAX_LENGTH).default(''),
    })
    .strict();
