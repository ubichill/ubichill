/**
 * 設定の「ストレージ」: 自分が上げたファイルの一覧（ページごと）・使っている量・容量・まとめて消す・
 * 使われていない画像を自動で消すか。
 */
import {
    STORED_FILE_PAGE_SIZE,
    type StorageOverview,
    type StorageSettings,
    StorageSettingsSchema,
    type StoredFile,
    StoredFileDeleteSchema,
    type StoredFilePage,
    type StoredFileRef,
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

interface Cursor {
    createdAtMicros: number;
    hash: string;
}

export interface StorageDeps {
    worldAssets: {
        listPageByOwner(
            ownerId: string,
            page: { limit: number; after?: Cursor },
        ): Promise<{ rows: OwnedWorldAsset[]; next: Cursor | null }>;
        usageOf(ownerId: string): Promise<{ bytes: number; count: number }>;
        removeMany(ownerId: string, hashes: readonly string[]): Promise<string[]>;
    };
    settings: {
        getStorage(userId: string): Promise<StorageSettings>;
        setStorage(userId: string, settings: StorageSettings): Promise<StorageSettings>;
    };
    quotaBytes(): Promise<number>;
    publicBaseUrl: string;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; status: 400; error: string };

export type Storage = ReturnType<typeof createStorage>;

/** 続きの位置を API に出す形（中身は見せない約束。`<マイクロ秒>.<ハッシュ>`）。 */
export const encodeStorageCursor = (cursor: Cursor): string => `${cursor.createdAtMicros}.${cursor.hash}`;

export function decodeStorageCursor(value: unknown): Cursor | null {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,17})\.([A-Za-z0-9_-]{1,64})$/.exec(value);
    if (!match?.[1] || !match[2]) return null;
    return { createdAtMicros: Number(match[1]), hash: match[2] };
}

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

    const page = async (userId: string, after?: Cursor): Promise<StoredFilePage> => {
        const { rows, next } = await deps.worldAssets.listPageByOwner(userId, { limit: STORED_FILE_PAGE_SIZE, after });
        return { items: rows.map(worldImage), next: next && encodeStorageCursor(next) };
    };

    return {
        async overview(userId: string): Promise<StorageOverview> {
            const [files, usage, settings, quotaBytes] = await Promise.all([
                page(userId),
                deps.worldAssets.usageOf(userId),
                deps.settings.getStorage(userId),
                deps.quotaBytes(),
            ]);
            return { ...settings, usage, quotaBytes, files };
        },

        async files(userId: string, cursor: unknown): Promise<Outcome<StoredFilePage>> {
            const after = decodeStorageCursor(cursor);
            if (!after) return { ok: false, status: 400, error: '続きの位置が正しくありません' };
            return { ok: true, value: await page(userId, after) };
        },

        /** まとめて消す。消せたものを返す（無いもの・ほかの人のものは黙って飛ばす）。 */
        async removeFiles(userId: string, input: unknown): Promise<Outcome<{ removed: StoredFileRef[] }>> {
            const parsed = StoredFileDeleteSchema.safeParse(input);
            if (!parsed.success) {
                return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? '入力が正しくありません' };
            }
            const hashes = [...new Set(parsed.data.files.map((file) => file.id))];
            const removed = await deps.worldAssets.removeMany(userId, hashes);
            return { ok: true, value: { removed: removed.map((id) => ({ kind: 'world-image', id })) } };
        },

        async updateSettings(userId: string, input: unknown): Promise<Outcome<StorageSettings>> {
            const parsed = StorageSettingsSchema.safeParse(input);
            if (!parsed.success) return { ok: false, status: 400, error: 'autoCleanup は true か false です' };
            return { ok: true, value: await deps.settings.setStorage(userId, parsed.data) };
        },
    };
}
