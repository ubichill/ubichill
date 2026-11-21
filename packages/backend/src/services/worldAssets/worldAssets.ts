/**
 * ワールドの作者が上げる画像（core:image・背景）。送られた画像は作り直してから置き（EXIF を消し、長い辺を縮めた WebP）、
 * 中身のハッシュを URL にする。持ち主ごとに数と大きさの上限を掛ける。
 */
import {
    WORLD_ASSET_MAX_EDGE,
    WORLD_ASSET_QUOTA,
    type WorldAsset,
    type WorldAssetList,
    worldAssetPath,
} from '@ubichill/shared';
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
            quota: { count: number; bytes: number },
        ): Promise<'added' | 'exists' | 'over-quota'>;
        find(ownerId: string, hash: string): Promise<WorldAssetRow | undefined>;
        findByHash(hash: string): Promise<WorldAssetBlob | undefined>;
        listByOwner(ownerId: string): Promise<WorldAssetRow[]>;
        remove(ownerId: string, hash: string): Promise<boolean>;
    };
    /** 送られた画像を作り直す（同時に走らせる数の制限込み。混んでいれば JobGateFullError） */
    process(input: Uint8Array, target: { width: number; height: number; fit: 'inside' }): Promise<ProcessImageResult>;
    publicBaseUrl: string;
}

export type WorldAssetErrorCode = ImageRejectionCode | 'quota-exceeded' | 'busy' | 'not-found';

export type WorldAssetOutcome<T> =
    | { ok: true; value: T }
    | { ok: false; status: 400 | 404 | 409 | 413 | 415 | 503; code: WorldAssetErrorCode; error: string };

const MB = 1024 * 1024;

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
            const added = await deps.repository.add(ownerId, { hash, bytes, width, height }, WORLD_ASSET_QUOTA);
            if (added === 'over-quota') {
                return {
                    ok: false,
                    status: 409,
                    code: 'quota-exceeded',
                    error: `画像は ${WORLD_ASSET_QUOTA.count} 枚・${WORLD_ASSET_QUOTA.bytes / MB} MB まで置けます。使っていない画像を消してから試してください`,
                };
            }
            const row = await deps.repository.find(ownerId, hash);
            if (!row) return { ok: false, status: 404, code: 'not-found', error: '画像が見つかりません' };
            return { ok: true, value: toAsset(row) };
        },

        async list(ownerId: string): Promise<WorldAssetList> {
            const rows = await deps.repository.listByOwner(ownerId);
            return {
                assets: rows.map(toAsset),
                usage: { count: rows.length, bytes: rows.reduce((sum, row) => sum + row.byteSize, 0) },
                quota: WORLD_ASSET_QUOTA,
            };
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
