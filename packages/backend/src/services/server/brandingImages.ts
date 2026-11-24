import {
    SERVER_IMAGE_VARIANTS,
    type ServerImageKind,
    type ServerImageVariant,
    serverImageVariantsOf,
} from '@ubichill/shared';
import type { ImageCodec, RenderTarget } from '../profiles/images/imageCodec';
import {
    type ImageRejectionCode,
    imageHashOf,
    type ProcessedImage,
    type ProcessImageLimits,
    processImage,
} from '../profiles/images/processImage';

export type ServerImage = Omit<ProcessedImage, 'contentType'> & { variant: ServerImageVariant; contentType: string };

export type ServerImageResult =
    | { ok: true; images: ServerImage[] }
    | { ok: false; code: ImageRejectionCode; message: string };

/** iOS は透明な部分を黒で塗るので、ホーム画面のアイコンは白で塗っておく */
const OPAQUE_BACKGROUND = '#ffffff';

const targetOf = (variant: ServerImageVariant): RenderTarget => {
    const spec: (typeof SERVER_IMAGE_VARIANTS)[ServerImageVariant] = SERVER_IMAGE_VARIANTS[variant];
    return {
        width: spec.width,
        height: spec.height,
        fit: 'cover',
        format: spec.format,
        ...('opaque' in spec ? { background: OPAQUE_BACKGROUND } : {}),
    };
};

const area = (variant: ServerImageVariant): number =>
    SERVER_IMAGE_VARIANTS[variant].width * SERVER_IMAGE_VARIANTS[variant].height;

/**
 * 送られた画像から、その種類で使うもの（shared の SERVER_IMAGE_VARIANTS）を全部作る。
 * 送られた画像を読むのは 1 回だけ（いちばん大きいものを作るときに確かめて作り直す）。小さいものは、作り直した画像から縮める。
 */
export async function processServerImage(
    kind: ServerImageKind,
    input: Uint8Array,
    codec: ImageCodec,
    limits: ProcessImageLimits,
): Promise<ServerImageResult> {
    const [largest, ...rest] = serverImageVariantsOf(kind).sort((a, b) => area(b) - area(a));
    if (!largest) return { ok: true, images: [] };
    const base = await processImage(input, targetOf(largest), codec, limits);
    if (!base.ok) return base;
    const derived = await Promise.all(
        rest.map(async (variant): Promise<ServerImage> => {
            const rendered = await codec.render(base.image.bytes, targetOf(variant));
            return {
                variant,
                hash: imageHashOf(rendered.bytes),
                contentType: `image/${SERVER_IMAGE_VARIANTS[variant].format}`,
                ...rendered,
            };
        }),
    ).catch(() => null);
    if (!derived) return { ok: false, code: 'undecodable', message: '画像を作り直せませんでした' };
    return { ok: true, images: [{ variant: largest, ...base.image }, ...derived] };
}
