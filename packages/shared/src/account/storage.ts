/**
 * 自分が上げたファイル（設定の「ストレージ」）と、1 人あたりの容量（コントロールパネル）。
 * 今はワールドの画像だけ。種類を足すときは StoredFile に kind の違う形を足す。
 */
import { z } from 'zod';
import { WORLD_ASSET_QUOTA_BYTES } from '../world/assets';

/** ファイルを使っている自分のワールド（下書き・版のどれか） */
export interface StoredFileUse {
    worldId: string;
    worldName: string;
}

export interface StoredWorldImage {
    kind: 'world-image';
    /** 種類の中で一意（ワールドの画像はハッシュ） */
    id: string;
    url: string;
    bytes: number;
    width: number;
    height: number;
    createdAt: string;
    usedBy: StoredFileUse[];
}

export type StoredFile = StoredWorldImage;

export interface StorageSettings {
    /** 使われていない画像を、上げてから決まった日数で消す */
    autoCleanup: boolean;
}

export const DEFAULT_STORAGE_SETTINGS: StorageSettings = { autoCleanup: true };

/** `PUT /users/me/storage/settings` */
export const StorageSettingsSchema = z.object({ autoCleanup: z.boolean() }).strict();

/** 一覧の 1 ページ（新しい順）。next は続きを読む `GET /users/me/storage/files?cursor=` の値（無ければ null）。 */
export interface StoredFilePage {
    items: StoredFile[];
    next: string | null;
}

/** 一覧の 1 ページの数 */
export const STORED_FILE_PAGE_SIZE = 50;

/** `GET /users/me/storage`。files は最初のページ。 */
export interface StorageOverview extends StorageSettings {
    usage: { bytes: number; count: number };
    quotaBytes: number;
    files: StoredFilePage;
}

/** 1 回で消せる数 */
export const STORED_FILE_DELETE_MAX = 100;

/** `POST /users/me/storage/files/delete`。応答は消せたもの（無いもの・ほかの人のものは入らない）。 */
export const StoredFileDeleteSchema = z
    .object({
        files: z
            .array(z.object({ kind: z.literal('world-image'), id: z.string().min(1).max(64) }).strict())
            .min(1, '消すファイルを選んでください')
            .max(STORED_FILE_DELETE_MAX, `1 回で消せるのは ${STORED_FILE_DELETE_MAX} 個までです`),
    })
    .strict();
export type StoredFileRef = Pick<StoredFile, 'kind' | 'id'>;

/** `GET /admin/storage` */
export interface StorageQuotaSettings {
    worldAssetQuotaBytes: number;
    /** サーバー全体のワールドの画像の合計 */
    totalBytes: number;
    updatedAt: string | null;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1024 を単位にした読みやすい大きさ（100 未満は小数 1 桁まで）。 */
export function formatBytes(bytes: number): string {
    const value = Math.max(0, bytes);
    const shown = UNITS.map((unit, i) => {
        const scaled = value / 1024 ** i;
        return { unit, amount: scaled < 100 ? Math.round(scaled * 10) / 10 : Math.round(scaled) };
    });
    const fit = shown.find((s) => s.amount < 1024) ?? shown.at(-1);
    return `${fit?.amount ?? 0} ${fit?.unit ?? 'B'}`;
}

/** `PUT /admin/storage` */
export const StorageQuotaInputSchema = z
    .object({
        worldAssetQuotaBytes: z
            .number({ message: '1 人あたりの容量を数で指定してください' })
            .int('1 人あたりの容量はバイトの整数で指定してください')
            .min(
                WORLD_ASSET_QUOTA_BYTES.min,
                `1 人あたりの容量は ${formatBytes(WORLD_ASSET_QUOTA_BYTES.min)} 以上にしてください`,
            )
            .max(
                WORLD_ASSET_QUOTA_BYTES.max,
                `1 人あたりの容量は ${formatBytes(WORLD_ASSET_QUOTA_BYTES.max)} 以下にしてください`,
            ),
    })
    .strict();
export type StorageQuotaInput = z.infer<typeof StorageQuotaInputSchema>;
