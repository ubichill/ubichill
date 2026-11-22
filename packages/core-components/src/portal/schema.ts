import { z } from 'zod';
import { PartLookSchema } from '../look.js';

export const PORTAL_TARGET_MAX_LENGTH = 2048;
export const PORTAL_LABEL_MAX_LENGTH = 60;

/** 行き先のワールドの書き方（`@ID/名前`・このサーバーのワールドの ID・ワールドの http(s) URL）。 */
export type PortalTarget = { kind: 'share'; path: string } | { kind: 'id'; id: string } | { kind: 'url'; url: string };

const HttpUrl = z.url({ protocol: /^https?$/ });
// 共有ページ（`/@handle/name`）の先頭の / を除いたもの。名前の文字は共有 URL の規則（/ ? # . 以外）に合わせる
const SHARE_PATH = /^@[a-z0-9_]{3,30}\/[^/?#.\s]{1,100}$/;
const WORLD_ID = /^[A-Za-z0-9._~-]{1,200}$/;

/** 行き先を読む。どれにも当たらなければ null（行けない）。 */
export function parsePortalTarget(value: string): PortalTarget | null {
    const target = value.trim();
    if (SHARE_PATH.test(target)) return { kind: 'share', path: target };
    if (HttpUrl.safeParse(target).success) return { kind: 'url', url: target };
    if (WORLD_ID.test(target)) return { kind: 'id', id: target };
    return null;
}

/**
 * `core:portal` の data。押すと、ほかのワールドへ移るポータル。行き先は `@ID/名前`（共有ページ）・ワールドの ID・
 * ワールドの URL のどれか。空なら押せない（エディタで置いた直後）。未知キーは拒否する。
 */
export const PortalDataSchema = z
    .object({
        world: z
            .string()
            .trim()
            .max(PORTAL_TARGET_MAX_LENGTH)
            .refine(
                (value) => value === '' || parsePortalTarget(value) !== null,
                '行き先は @ID/名前・ワールドの ID・ワールドの URL のどれかにしてください',
            )
            .default(''),
        /** ポータルに出す名前（空なら行き先の名前か「ポータル」）。見た目なしでは読み上げる名前 */
        label: z.string().max(PORTAL_LABEL_MAX_LENGTH).default(''),
        look: PartLookSchema,
    })
    .strict();
