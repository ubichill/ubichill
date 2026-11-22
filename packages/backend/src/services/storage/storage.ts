/**
 * 設定の「ストレージ」: 自分が上げたファイルの一覧・使っている量・容量と、使われていない画像を自動で消すか。
 * ファイルを消すのは種類ごとの API（ワールドの画像は `DELETE /api/v1/assets/:hash.webp`）。
 */
import {
    type StorageOverview,
    type StorageSettings,
    StorageSettingsSchema,
    type StoredFile,
    type StoredFileUse,
    worldAssetPath,
} from '@ubichill/shared';

interface OwnedWorldAsset {
    hash: string;
    width: number;
    height: number;
    byteSize: number;
    createdAt: Date;
    usedBy: StoredFileUse[];
}

export interface StorageDeps {
    worldAssets: { listByOwner(ownerId: string): Promise<OwnedWorldAsset[]> };
    settings: {
        getStorage(userId: string): Promise<StorageSettings>;
        setStorage(userId: string, settings: StorageSettings): Promise<StorageSettings>;
    };
    quotaBytes(): Promise<number>;
    publicBaseUrl: string;
}

export type StorageSettingsOutcome = { ok: true; value: StorageSettings } | { ok: false; status: 400; error: string };

export type Storage = ReturnType<typeof createStorage>;

export function createStorage(deps: StorageDeps) {
    const worldImage = (row: OwnedWorldAsset): StoredFile => ({
        kind: 'world-image',
        id: row.hash,
        url: `${deps.publicBaseUrl}${worldAssetPath(row.hash)}`,
        bytes: row.byteSize,
        width: row.width,
        height: row.height,
        createdAt: row.createdAt.toISOString(),
        usedBy: row.usedBy,
    });

    return {
        async overview(userId: string): Promise<StorageOverview> {
            const [assets, settings, quotaBytes] = await Promise.all([
                deps.worldAssets.listByOwner(userId),
                deps.settings.getStorage(userId),
                deps.quotaBytes(),
            ]);
            const files = assets.map(worldImage);
            return {
                ...settings,
                usage: { bytes: files.reduce((sum, file) => sum + file.bytes, 0), count: files.length },
                quotaBytes,
                files,
            };
        },

        async updateSettings(userId: string, input: unknown): Promise<StorageSettingsOutcome> {
            const parsed = StorageSettingsSchema.safeParse(input);
            if (!parsed.success) return { ok: false, status: 400, error: 'autoCleanup は true か false です' };
            return { ok: true, value: await deps.settings.setStorage(userId, parsed.data) };
        },
    };
}
