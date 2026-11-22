import { z } from 'zod';
import { EntityIdRef } from '../entityRef.js';
import { PartLookSchema } from '../look.js';

export const SWITCH_LABEL_MAX_LENGTH = 60;
export const SWITCH_MAX_TARGETS = 32;

/**
 * `core:switch` の data。押すと、対象の Entity（とその子）の見える・見えないを、部屋の全員で切り替える。
 * 切り替えるのはインスタンス（Go）で、クライアントは押したことを伝えるだけ。
 */
export const SwitchDataSchema = z
    .object({
        targets: z
            .array(EntityIdRef.refine((id) => id !== '', '対象を選んでください'))
            .max(SWITCH_MAX_TARGETS)
            .default([]),
        /** ボタンに出す文字（空なら「スイッチ」）。見た目なしでは読み上げる名前 */
        label: z.string().max(SWITCH_LABEL_MAX_LENGTH).default(''),
        look: PartLookSchema,
    })
    .strict();
