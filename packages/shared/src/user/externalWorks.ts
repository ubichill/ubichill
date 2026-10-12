/**
 * 外部の作品（作者が GitHub Pages などに置いたワールド・mod）をユーザーページに出すための純粋な知識。
 *
 * サーバーは中身を持たず、作者が署名したときに登録した URL だけを持つ。登録は作者本人の署名が付いた内容でしか
 * 受け付けず、表示する前に「その URL が本人の署名付きの作品をいま配っているか」を確かめる（登録時点では公開前のことがある）。
 */
import { z } from 'zod';
import { ModLockEntrySchema } from '../schemas/modLock.schema';

export const EXTERNAL_WORK_KINDS = ['world', 'mod'] as const;
export type ExternalWorkKind = (typeof EXTERNAL_WORK_KINDS)[number];

/** 1 人が登録できる外部の作品の数。 */
export const MAX_EXTERNAL_WORKS_PER_USER = 200;

/**
 * 外部の作品の URL（https のみ。開発用に localhost / 127.0.0.1 の http も許す）。認証情報・フラグメント・空白を含まない。
 * world は `.yaml`（`.yml`）の URL、mod は配布の基点（`<基点>/<modId>/v<版>/`、ワールドの lock の baseUrl と同じ）。
 */
export const ExternalWorkUrlSchema = z
    .string()
    .max(2048)
    .regex(
        /^(?:https:\/\/[a-z0-9.-]+(?::\d{1,5})?|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)(?:\/[^\s#@\\]*)?$/,
        'https の URL を指定してください',
    );

export const ExternalWorkRegistrationSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('world'),
        url: ExternalWorkUrlSchema.refine((v) => /\.ya?ml$/i.test(v), 'ワールドは .yaml の URL を指定してください'),
        /** 配信する world.yaml の中身（署名を確かめるため。サーバーは保存しない）。 */
        yaml: z.string().max(1_000_000),
        lock: z.unknown().optional(),
        signature: z.unknown(),
    }),
    z.object({
        kind: z.literal('mod'),
        url: ExternalWorkUrlSchema.refine((v) => !v.endsWith('/'), '末尾の / は付けないでください'),
        entry: ModLockEntrySchema,
        signature: z.unknown(),
    }),
]);
export type ExternalWorkRegistration = z.infer<typeof ExternalWorkRegistrationSchema>;

/** 登録された外部の作品（本人の設定画面に出す）。 */
export interface ExternalWork {
    kind: ExternalWorkKind;
    url: string;
    /** world は metadata.name、mod は mod の ID。 */
    name: string;
    /** mod の版（最後に登録した版）。world は無し。 */
    version?: string;
    registeredAt: string;
}

/** 公開している mod（ユーザーページに出す）。 */
export interface PublishedMod {
    id: string;
    name: string;
    version: string;
    /** 配布の基点（ワールドの依存 `source.url` に書く値）。 */
    url: string;
}
