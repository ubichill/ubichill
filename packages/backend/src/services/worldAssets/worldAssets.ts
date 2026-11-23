/**
 * ワールドの作者が上げる画像（core:image・背景）。送られた画像は作り直してから置き（EXIF を消し、長い辺を縮めた WebP）、
 * 中身のハッシュを URL にする。持ち主ごとに合計の大きさの上限（管理者が決める）を掛ける。一覧は設定の「ストレージ」（services/storage）。
 */
import { formatBytes, WORLD_ASSET_MAX_EDGE, type WorldAsset, worldAssetPath } from '@ubichill/shared';
import { JobGateFullError } from '../../utils/jobGate';
import type { ImageRejectionCode, ProcessImageResult } from '../profiles/images/processImage';

export interface WorldAssetBlob {
    hash: string;
    bytes: Uint8Array;
    width: number;
    height: number;
}

interface WorldAssetRow {
    hash: string;
    width: number;
    height: number;
    byteSize: number;
    createdAt: Date;
}

export interface WorldAssetDeps {
    repository: {
        add(
            ownerId: string,
            image: WorldAssetBlob,
            quotaBytes: number,
        ): Promise<{ status: 'added' | 'exists' } | { status: 'over-quota'; usedBytes: number }>;
        find(ownerId: string, hash: string): Promise<WorldAssetRow | undefined>;
        findByHash(hash: string): Promise<WorldAssetBlob | undefined>;
        remove(ownerId: string, hash: string): Promise<boolean>;
    };
    /** 送られた画像を作り直す（同時に走らせる数の制限込み。混んでいれば JobGateFullError） */
    process(input: Uint8Array, target: { width: number; height: number; fit: 'inside' }): Promise<ProcessImageResult>;
    /** 1 人が置ける合計（管理者の設定） */
    quotaBytes(): Promise<number>;
    publicBaseUrl: string;
}

export type WorldAssetErrorCode = ImageRejectionCode | 'quota-exceeded' | 'busy' | 'not-found';

export type WorldAssetOutcome<T> =
    | { ok: true; value: T }
    | { ok: false; status: 400 | 404 | 409 | 413 | 415 | 503; code: WorldAssetErrorCode; error: string };

const REJECTION_STATUS: Record<ImageRejectionCode, 400 | 413 | 415> = {
    empty: 400,
    'too-large': 413,
    unsupported: 415,
    'too-many-pixels': 400,
    undecodable: 400,
};

export type WorldAssetService = ReturnType<typeof createWorldAssets>;

export function createWorldAssets(deps: WorldAssetDeps) {
    const toAsset = (row: WorldAssetRow): WorldAsset => ({
        hash: row.hash,
        url: `${deps.publicBaseUrl}${worldAssetPath(row.hash)}`,
        width: row.width,
        height: row.height,
        bytes: row.byteSize,
        createdAt: row.createdAt.toISOString(),
    });

    return {
        async upload(ownerId: string, input: Uint8Array): Promise<WorldAssetOutcome<WorldAsset>> {
            const processed = await deps
                .process(input, { width: WORLD_ASSET_MAX_EDGE, height: WORLD_ASSET_MAX_EDGE, fit: 'inside' })
                .catch((error: unknown) => {
                    if (error instanceof JobGateFullError) return null;
                    throw error;
                });
            if (!processed) {
                return {
                    ok: false,
                    status: 503,
                    code: 'busy',
                    error: '画像の処理が混み合っています。少し待ってから試してください',
                };
            }
            if (!processed.ok) {
                return {
                    ok: false,
                    status: REJECTION_STATUS[processed.code],
                    code: processed.code,
                    error: processed.message,
                };
            }
            const { hash, bytes, width, height } = processed.image;
            const quotaBytes = await deps.quotaBytes();
            const added = await deps.repository.add(ownerId, { hash, bytes, width, height }, quotaBytes);
            if (added.status === 'over-quota') {
                return {
                    ok: false,
                    status: 409,
                    code: 'quota-exceeded',
                    error: `画像は 1 人 ${formatBytes(quotaBytes)} まで置けます。今 ${formatBytes(added.usedBytes)} 使っていて、この画像（${formatBytes(bytes.byteLength)}）は入りません。設定の「ストレージ」で使っていない画像を消してから試してください`,
                };
            }
            const row = await deps.repository.find(ownerId, hash);
            if (!row) return { ok: false, status: 404, code: 'not-found', error: '画像が見つかりません' };
            return { ok: true, value: toAsset(row) };
        },

        async remove(ownerId: string, hash: string): Promise<WorldAssetOutcome<null>> {
            return (await deps.repository.remove(ownerId, hash))
                ? { ok: true, value: null }
                : { ok: false, status: 404, code: 'not-found', error: '画像が見つかりません' };
        },

        /** 配信する中身 */
        image(hash: string): Promise<WorldAssetBlob | undefined> {
            return deps.repository.findByHash(hash);
        },
    };
}
