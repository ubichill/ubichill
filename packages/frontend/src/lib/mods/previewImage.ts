/**
 * mod の見た目の画像（mod のサムネイル・Component・プレハブ）を、hash を確かめてから表示する。
 * 画像は mod の配布先にある。manifest（lock で固定）の assetIntegrity と照らし、一致したものだけを
 * ページの中だけで使える URL（blob:）にして出す。公開後に配布先で画像を差し替えても、固定した画像以外は出ない。
 */
import { sriOf } from '@ubichill/loader';
import { MAX_PREVIEW_IMAGE_BYTES, previewImageType } from '@ubichill/shared';

export interface PreviewImageSource {
    url: string;
    integrity: string;
    type: string;
}

/**
 * manifest の画像の参照先から、取得先と固定した hash を決める（純粋）。
 * assetIntegrity に無いもの・画像でないもの・package の外を指すものは出さない。
 */
export function previewImageSource(
    manifest: { assetIntegrity?: Readonly<Record<string, string>> },
    versionedBase: string,
    path: string | undefined,
): PreviewImageSource | undefined {
    if (!path || path.startsWith('/') || path.includes('\\') || path.split('/').some((s) => s === '..' || s === ''))
        return undefined;
    const integrity = manifest.assetIntegrity?.[path];
    const type = previewImageType(path);
    if (!integrity || !type) return undefined;
    return { url: `${versionedBase}/${path.split('/').map(encodeURIComponent).join('/')}`, integrity, type };
}

/** 取得して hash を確かめた画像。一致しなければ、大きすぎれば失敗する。 */
export async function fetchVerifiedImage(
    source: PreviewImageSource,
    fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Blob> {
    const res = await fetchImpl(source.url, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`画像を取得できません (${res.status})`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_PREVIEW_IMAGE_BYTES) throw new Error('画像が大きすぎます');
    if ((await sriOf(bytes)) !== source.integrity) throw new Error('画像が固定した内容と一致しません');
    return new Blob([bytes], { type: source.type });
}

/** 同じ画像（同じ hash）は 1 回だけ取得する。画面を開いている間だけ持つ。 */
const objectUrls = new Map<string, Promise<string>>();

export function verifiedImageUrl(source: PreviewImageSource): Promise<string> {
    const cached = objectUrls.get(source.integrity);
    if (cached) return cached;
    const pending = fetchVerifiedImage(source).then((blob) => URL.createObjectURL(blob));
    // 失敗は覚えない（通信の一時的な失敗のあと、開き直せば取り直す）
    pending.catch(() => objectUrls.delete(source.integrity));
    objectUrls.set(source.integrity, pending);
    return pending;
}

/**
 * 取得した package（lock の 1 件と manifest）の画像。mod のサムネイル・Component・プレハブの見た目に使う。
 * `fallbackBase` は取得元の無い（本体の mods の）package の置き場所。
 */
export function packagePreviewImage(
    pkg: {
        entry: { id: string; version: string; baseUrl?: string };
        manifest: { assetIntegrity?: Readonly<Record<string, string>> };
    },
    path: string | undefined,
    fallbackBase: string,
): PreviewImageSource | undefined {
    const base = `${(pkg.entry.baseUrl ?? fallbackBase).replace(/\/$/, '')}/${pkg.entry.id}/v${pkg.entry.version}`;
    return previewImageSource(pkg.manifest, base, path);
}
