/**
 * ホームワールドの純粋な知識。ログインしたら（`/` を開いたら）ここで決めたワールドの部屋に入る。
 *
 * - worldRef: ワールドの正規 URL。未設定（null）なら公式の既定ワールド
 * - accessType: ホームの部屋の公開範囲。初期値は招待のみ（ログインのたびに公開一覧へ部屋を出さない）
 */
import { z } from 'zod';
import { AccessType, type Instance, type WorldListItem } from '../schemas/instance.schema';

/** ホームを設定していない人が入るワールド（公式ワールドの id）。 */
export const DEFAULT_HOME_WORLD_REF = 'default';
export const DEFAULT_HOME_ACCESS_TYPE: AccessType = 'invite_only';

export interface HomeSettings {
    worldRef: string | null;
    accessType: AccessType;
}

export const DEFAULT_HOME_SETTINGS: HomeSettings = { worldRef: null, accessType: DEFAULT_HOME_ACCESS_TYPE };

/** `PUT /users/me/home`。worldRef に null を渡すと既定のワールドに戻す。省略した項目は変えない。 */
export const HomeSettingsUpdateSchema = z
    .object({
        worldRef: z.string().trim().min(1).max(2048).nullable().optional(),
        accessType: AccessType.optional(),
    })
    .strict()
    .refine((v) => v.worldRef !== undefined || v.accessType !== undefined, {
        message: 'worldRef か accessType のどちらかを指定してください',
    });
export type HomeSettingsUpdate = z.infer<typeof HomeSettingsUpdateSchema>;

/** `GET /users/me/home`。world はホームのワールド（解決できなければ null）。 */
export interface HomeView extends HomeSettings {
    world: WorldListItem | null;
}

/**
 * `POST /users/me/home/instance`。fallback は、ホームのワールドを開けず既定のワールドで入ったとき。
 * reused は既にあった自分のホームの部屋を返したとき。
 */
export interface HomeInstanceResponse {
    instance: Instance;
    reused: boolean;
    fallback?: 'unresolvable';
}

/** 設定の変更を今の設定に当てる（省略した項目はそのまま）。 */
export function applyHomeUpdate(current: HomeSettings, update: HomeSettingsUpdate): HomeSettings {
    return {
        worldRef: update.worldRef === undefined ? current.worldRef : update.worldRef,
        accessType: update.accessType ?? current.accessType,
    };
}
