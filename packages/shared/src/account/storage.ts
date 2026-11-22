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

/** `GET /users/me/storage`。files は新しい順。 */
export interface StorageOverview extends StorageSettings {
    usage: { bytes: number; count: number };
    quotaBytes: number;
    files: StoredFile[];
}

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
