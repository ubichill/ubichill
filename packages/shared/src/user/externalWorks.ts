/**
 * 外部の作品（作者が GitHub Pages などに置いたワールド・mod）をユーザーページに出すための純粋な知識。
 *
 * サーバーは中身を持たず、作者が署名したときに登録した URL だけを持つ。登録は作者本人の署名が付いた内容でしか
 * 受け付けず、表示する前に「その URL が本人の署名付きの作品をいま配っているか」を確かめる（登録時点では公開前のことがある）。
 */
import { z } from 'zod';
import { ModLockEntrySchema } from '../schemas/modLock.schema';
import { LIMITS } from '../schemas/world.schema';

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
        /** 配信する world.yaml の中身（署名を確かめるため。サーバーは保存しない）。上限は外部のワールドを取り込むときと同じ。 */
        yaml: z.string().max(LIMITS.MAX_YAML_SIZE, `ワールドの YAML は ${LIMITS.MAX_YAML_SIZE} 文字までです`),
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

/**
 * 公開先を確かめた結果。
 * - published: 本人の署名付きで配られている（ユーザーページに出る）
 * - not-found: 公開先に無い（まだ公開前・取り下げた。ワールドは取得の失敗もここに入る）
 * - unreachable: 公開先に届かない（通信・サーバーの障害。時間をおいて確かめ直す）
 * - invalid: 配られているが、本人の署名と確かめられない（内容の書き換え・鍵の取り消し・名前の変更・別の作品）
 */
export const EXTERNAL_WORK_STATUSES = ['published', 'not-found', 'unreachable', 'invalid'] as const;
export type ExternalWorkStatus = (typeof EXTERNAL_WORK_STATUSES)[number];

/** 登録された外部の作品（本人の設定画面に出す）。 */
export interface ExternalWork {
    kind: ExternalWorkKind;
    url: string;
    /** world は metadata.name、mod は mod の ID。 */
    name: string;
    /** mod の版（最後に登録した版）。world は無し。 */
    version?: string;
    registeredAt: string;
    status: ExternalWorkStatus;
    /** 公開先を確かめた時刻（ISO 8601）。 */
    checkedAt: string;
}

/** 公開している mod（ユーザーページに出す）。 */
export interface PublishedMod {
    id: string;
    name: string;
    version: string;
    /** 配布の基点（ワールドの依存 `source.url` に書く値）。 */
    url: string;
}
