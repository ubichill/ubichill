import { createHash } from 'node:crypto';
import {
    PROFILE_IMAGE_CONTENT_TYPE,
    PROFILE_IMAGE_MAX_BYTES,
    PROFILE_IMAGE_MAX_PIXELS,
    PROFILE_IMAGE_SIZES,
    type ProfileImageKind,
} from '@ubichill/shared';
import type { ImageCodec } from './imageCodec';

/** 受け付ける形式。SVG（外部参照・スクリプト）・TIFF・PDF など、アイコンに要らない読み込み口は開けない。 */
const ACCEPTED_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);

export interface ProcessedImage {
    /** 中身の SHA-256（base64url）。配信する URL に入れる */
    hash: string;
    contentType: typeof PROFILE_IMAGE_CONTENT_TYPE;
    bytes: Uint8Array;
    width: number;
    height: number;
}

export type ImageRejectionCode = 'empty' | 'too-large' | 'unsupported' | 'too-many-pixels' | 'undecodable';

export type ProcessImageResult =
    | { ok: true; image: ProcessedImage }
    | { ok: false; code: ImageRejectionCode; message: string };

export interface ProcessImageLimits {
    maxBytes: number;
    maxPixels: number;
}

const DEFAULT_LIMITS: ProcessImageLimits = { maxBytes: PROFILE_IMAGE_MAX_BYTES, maxPixels: PROFILE_IMAGE_MAX_PIXELS };

const reject = (code: ImageRejectionCode, message: string): ProcessImageResult => ({ ok: false, code, message });

export const imageHashOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('base64url');

/**
 * 送られた画像を、配信してよい形（向きを直し・メタデータを消し・決まった大きさの WebP）に作り直す。
 * 送られたバイト列はそのまま配らない（位置情報などの EXIF・細工したファイルを他人に渡さない）。
 */
export async function processProfileImage(
    input: Uint8Array,
    kind: ProfileImageKind,
    codec: ImageCodec,
    limits: ProcessImageLimits = DEFAULT_LIMITS,
): Promise<ProcessImageResult> {
    if (input.byteLength === 0) return reject('empty', '画像が空です');
    if (input.byteLength > limits.maxBytes) {
        return reject('too-large', `画像は ${Math.floor(limits.maxBytes / 1024 / 1024)} MB までです`);
    }
    const probe = await codec.probe(input);
    if (!probe) return reject('undecodable', '画像として読めません');
    if (!ACCEPTED_FORMATS.has(probe.format)) {
        return reject('unsupported', 'JPEG・PNG・WebP・GIF・AVIF の画像を選んでください');
    }
    if (probe.width * probe.height > limits.maxPixels) {
        return reject('too-many-pixels', '画像の画素数が多すぎます。小さくしてから選んでください');
    }
    const rendered = await codec.render(input, PROFILE_IMAGE_SIZES[kind]).catch(() => null);
    if (!rendered) return reject('undecodable', '画像として読めません（壊れているか、対応していない形式です）');
    return {
        ok: true,
        image: {
            hash: imageHashOf(rendered.bytes),
            contentType: PROFILE_IMAGE_CONTENT_TYPE,
            bytes: rendered.bytes,
            width: rendered.width,
            height: rendered.height,
        },
    };
}
