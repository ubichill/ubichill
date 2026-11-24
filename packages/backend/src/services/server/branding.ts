/**
 * サーバーのブランディング（コントロールパネルの「ブランディング」）: 略称・テーマの色・アイコン・バナー。
 * 画像はプロフィール画像と同じく、送られたものを作り直してから置く。
 */
import {
    type ServerBranding,
    type ServerBrandingUpdate,
    ServerBrandingUpdateSchema,
    type ServerImageKind,
    serverBrandingImages,
} from '@ubichill/shared';
import { JobGateFullError } from '../../utils/jobGate';
import type { ImageRejectionCode } from '../profiles/images/processImage';
import type { ServerImage, ServerImageResult } from './brandingImages';

interface StoredServerImage {
    hash: string;
    contentType: string;
    bytes: Uint8Array;
}

export interface BrandingDeps {
    repository: {
        get(): Promise<ServerBrandingUpdate | null>;
        put(record: ServerBrandingUpdate): Promise<void>;
        images(): Promise<Array<{ variant: string; hash: string }>>;
        image(variant: string, hash: string): Promise<StoredServerImage | undefined>;
        replaceImages(kind: ServerImageKind, images: ServerImage[]): Promise<void>;
        removeImages(kind: ServerImageKind): Promise<boolean>;
    };
    /** 送られた画像から使うものを作る（同時に走らせる数の制限込み。混んでいれば JobGateFullError）。 */
    processImage(kind: ServerImageKind, input: Uint8Array): Promise<ServerImageResult>;
    /** 配信する URL の基点（PUBLIC_BASE_URL） */
    publicBaseUrl: string;
}

export type BrandingErrorCode = 'invalid' | 'busy' | ImageRejectionCode;

export type BrandingOutcome =
    | { ok: true; value: ServerBranding }
    | { ok: false; status: number; error: string; code: BrandingErrorCode };

const IMAGE_REJECTION_STATUS: Readonly<Record<ImageRejectionCode, number>> = {
    empty: 400,
    'too-large': 413,
    unsupported: 415,
    'too-many-pixels': 422,
    undecodable: 422,
};

export type BrandingService = ReturnType<typeof createBranding>;

export function createBranding(deps: BrandingDeps) {
    const branding = async (): Promise<ServerBranding> => {
        const [record, images] = await Promise.all([deps.repository.get(), deps.repository.images()]);
        return {
            shortName: record?.shortName ?? null,
            themeColor: record?.themeColor ?? null,
            ...serverBrandingImages(images, deps.publicBaseUrl),
        };
    };
    const current = async (): Promise<BrandingOutcome> => ({ ok: true, value: await branding() });

    return {
        branding,

        /** 略称とテーマの色を置き換える（両方を送る。空は既定に戻す）。 */
        async update(input: unknown): Promise<BrandingOutcome> {
            const parsed = ServerBrandingUpdateSchema.safeParse(input);
            if (!parsed.success) {
                return {
                    ok: false,
                    status: 400,
                    code: 'invalid',
                    error: parsed.error.issues[0]?.message ?? '入力が正しくありません',
                };
            }
            await deps.repository.put(parsed.data);
            return current();
        },

        /** 画像を作り直して置き換える。送られたバイト列はそのまま保存しない。 */
        async replaceImage(kind: ServerImageKind, input: Uint8Array): Promise<BrandingOutcome> {
            const processed = await deps.processImage(kind, input).catch((err: unknown) => {
                if (err instanceof JobGateFullError) return null;
                throw err;
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
                    status: IMAGE_REJECTION_STATUS[processed.code],
                    code: processed.code,
                    error: processed.message,
                };
            }
            await deps.repository.replaceImages(kind, processed.images);
            return current();
        },

        /** 画像を外す（既定の見た目に戻る）。無くても失敗にしない。 */
        async removeImage(kind: ServerImageKind): Promise<BrandingOutcome> {
            await deps.repository.removeImages(kind);
            return current();
        },

        image(variant: string, hash: string): Promise<StoredServerImage | undefined> {
            return deps.repository.image(variant, hash);
        },
    };
}
