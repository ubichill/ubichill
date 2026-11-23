/**
 * 1 人が置けるワールドの画像の合計（コントロールパネルの「全般」）。保存していなければ既定の値。
 * 下げても置いてある画像は消さない（越えている人は、減らすまで新しく置けない）。
 */
import { StorageQuotaInputSchema, type StorageQuotaSettings, WORLD_ASSET_QUOTA_BYTES } from '@ubichill/shared';

export interface StorageQuotaDeps {
    repository: {
        get(): Promise<{ worldAssetQuotaBytes: number; updatedAt: Date } | null>;
        put(input: { worldAssetQuotaBytes: number }): Promise<void>;
    };
    /** サーバー全体の画像の合計 */
    totalBytes(): Promise<number>;
}

export type StorageQuotaUpdateOutcome =
    | { ok: true; value: StorageQuotaSettings }
    | { ok: false; status: 400; error: string };

export type StorageQuota = ReturnType<typeof createStorageQuota>;

export function createStorageQuota(deps: StorageQuotaDeps) {
    const settings = async (): Promise<StorageQuotaSettings> => {
        const [row, totalBytes] = await Promise.all([deps.repository.get(), deps.totalBytes()]);
        return {
            worldAssetQuotaBytes: row?.worldAssetQuotaBytes ?? WORLD_ASSET_QUOTA_BYTES.default,
            totalBytes,
            updatedAt: row?.updatedAt.toISOString() ?? null,
        };
    };

    return {
        settings,

        async worldAssetQuotaBytes(): Promise<number> {
            return (await deps.repository.get())?.worldAssetQuotaBytes ?? WORLD_ASSET_QUOTA_BYTES.default;
        },

        async update(input: unknown): Promise<StorageQuotaUpdateOutcome> {
            const parsed = StorageQuotaInputSchema.safeParse(input);
            if (!parsed.success) {
                return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? '入力が正しくありません' };
            }
            await deps.repository.put(parsed.data);
            return { ok: true, value: await settings() };
        },
    };
}
