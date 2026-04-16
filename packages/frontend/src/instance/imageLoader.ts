/**
 * imageLoader
 *
 * ANI / CUR / ICO / PNG 等の画像ファイルを PNG data URL に変換する汎用ローダー。
 * プラグインが Worker からバージョン付き URL を送ってきたとき、
 * Host 側でデコードして利用可能な形式に変換する。
 *
 * - Worker サンドボックス内での DOM API 使用を回避
 * - キャッシュをモジュールレベルで管理し重複フェッチを防止
 */

import { parseICO } from 'icojs/browser';

/** デコード済み画像。hotspot はアンカー座標（ANI/CUR の場合に意味を持つ）。 */
export interface DecodedImage {
    url: string;
    hotspot: { x: number; y: number };
}

const _cache = new Map<string, Promise<DecodedImage>>();

/** ANI (RIFF) から最初のフレームの ArrayBuffer を取り出す */
function _extractAniFrame(buffer: ArrayBuffer): ArrayBuffer {
    const view = new DataView(buffer);
    let offset = 12;
    while (offset < buffer.byteLength - 8) {
        const chunkId = String.fromCharCode(
            view.getUint8(offset),
            view.getUint8(offset + 1),
            view.getUint8(offset + 2),
            view.getUint8(offset + 3),
        );
        const chunkSize = view.getUint32(offset + 4, true);
        if (chunkId === 'LIST') {
            offset += 12;
            continue;
        }
        if (chunkId === 'fram') {
            offset += 8;
            continue;
        }
        if (chunkId === 'icon') {
            return buffer.slice(offset + 8, offset + 8 + chunkSize);
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    throw new Error(`ANI: no icon frame found in ${buffer.byteLength} bytes`);
}

/** ICO / CUR バッファを最大解像度 PNG data URL + アンカー座標に変換 */
async function _icoToDecoded(buffer: ArrayBuffer): Promise<DecodedImage> {
    const images = await parseICO(buffer, 'image/png');
    if (!images.length) throw new Error('ICO/CUR: no images found');
    const best = images.reduce((a, b) => (a.width >= b.width ? a : b));
    const bytes = new Uint8Array(best.buffer);
    const CHUNK = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    const hotspot = (best as { hotspot?: { x: number; y: number } }).hotspot ?? { x: 0, y: 0 };
    return { url: `data:image/png;base64,${btoa(binary)}`, hotspot };
}

/**
 * 画像ファイルを読み込み、DecodedImage（PNG data URL + アンカー座標）に変換する。
 *
 * - `.ani` → RIFF から最初のフレームを抽出 → PNG
 * - `.cur` / `.ico` → icojs で PNG に変換、CUR はアンカー座標を保持
 * - その他（`.png`, `.svg` 等） → URL をそのまま使用
 *
 * 同一 URL はモジュールレベルでキャッシュされ、重複デコードを防ぐ。
 */
export function loadImage(url: string): Promise<DecodedImage> {
    if (!_cache.has(url)) {
        const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
        let p: Promise<DecodedImage>;
        if (ext === 'ani') {
            p = fetch(url)
                .then((r) => r.arrayBuffer())
                .then((buf) => _icoToDecoded(_extractAniFrame(buf)));
        } else if (ext === 'cur' || ext === 'ico') {
            p = fetch(url)
                .then((r) => r.arrayBuffer())
                .then((buf) => _icoToDecoded(buf));
        } else {
            p = Promise.resolve({ url, hotspot: { x: 0, y: 0 } });
        }
        p.catch((err) => {
            console.error(`[imageLoader] 画像の読み込みに失敗しました: ${url}`, err);
            _cache.delete(url);
        });
        _cache.set(url, p);
    }
    return _cache.get(url) as Promise<DecodedImage>;
}
