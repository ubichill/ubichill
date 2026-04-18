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

import type { AvatarStateFrame } from '@ubichill/shared';
import { parseICO } from 'icojs/browser';

/** デコード済み画像。frames はローカルアニメーション用のみ（サーバー送信しない）。 */
export interface DecodedImage {
    url: string;
    hotspot: { x: number; y: number };
    frames: AvatarStateFrame[]; // 1要素の場合はアニメーションなし
}

const _cache = new Map<string, Promise<DecodedImage>>();

/** ICO / CUR バッファを PNG data URL + アンカー座標に変換 */
async function _icoToPng(buffer: ArrayBuffer): Promise<{ url: string; hotspot: { x: number; y: number } }> {
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
 * ANI (RIFF/ACON) を全フレーム＋タイミングごと解析し DecodedImage を返す。
 *
 * 解析する RIFF チャンク:
 *   anih — numFrames / numSteps / iDispRate（デフォルトレート）
 *   rate — ステップ毎のレート（jiffy 単位）
 *   seq  — フレーム表示順序
 *   LIST/fram/icon — 各フレームの ICO/CUR データ
 */
async function _decodeAni(buffer: ArrayBuffer): Promise<DecodedImage> {
    const view = new DataView(buffer);
    let offset = 12; // "RIFF" + size + "ACON"

    let numFrames = 0;
    let numSteps = 0;
    let defaultJiffies = 6;
    const iconBuffers: ArrayBuffer[] = [];
    let rateJiffies: number[] | null = null;
    let seqIndices: number[] | null = null;
    let hotspot = { x: 0, y: 0 };

    while (offset + 8 <= buffer.byteLength) {
        const id =
            String.fromCharCode(view.getUint8(offset)) +
            String.fromCharCode(view.getUint8(offset + 1)) +
            String.fromCharCode(view.getUint8(offset + 2)) +
            String.fromCharCode(view.getUint8(offset + 3));
        const chunkSize = view.getUint32(offset + 4, true);
        const dataStart = offset + 8;
        const nextOffset = dataStart + chunkSize + (chunkSize & 1);

        if (id === 'anih' && chunkSize >= 36) {
            numFrames = view.getUint32(dataStart + 4, true);
            numSteps = view.getUint32(dataStart + 8, true);
            defaultJiffies = view.getUint32(dataStart + 28, true) || 6;
        } else if (id === 'rate') {
            rateJiffies = [];
            for (let i = 0; i + 4 <= chunkSize; i += 4) {
                rateJiffies.push(view.getUint32(dataStart + i, true));
            }
        } else if (id === 'seq ' || id === 'seq\0') {
            seqIndices = [];
            for (let i = 0; i + 4 <= chunkSize; i += 4) {
                seqIndices.push(view.getUint32(dataStart + i, true));
            }
        } else if (id === 'LIST') {
            const listType =
                String.fromCharCode(view.getUint8(dataStart)) +
                String.fromCharCode(view.getUint8(dataStart + 1)) +
                String.fromCharCode(view.getUint8(dataStart + 2)) +
                String.fromCharCode(view.getUint8(dataStart + 3));
            if (listType === 'fram') {
                let inner = dataStart + 4;
                const listEnd = dataStart + chunkSize;
                while (inner + 8 <= listEnd) {
                    const innerId =
                        String.fromCharCode(view.getUint8(inner)) +
                        String.fromCharCode(view.getUint8(inner + 1)) +
                        String.fromCharCode(view.getUint8(inner + 2)) +
                        String.fromCharCode(view.getUint8(inner + 3));
                    const innerSize = view.getUint32(inner + 4, true);
                    if (innerId === 'icon') {
                        iconBuffers.push(buffer.slice(inner + 8, inner + 8 + innerSize));
                    }
                    inner += 8 + innerSize + (innerSize & 1);
                }
            }
        }

        offset = nextOffset;
    }

    if (iconBuffers.length === 0) throw new Error('ANI: no icon frames found');

    const steps = numSteps || numFrames || iconBuffers.length;
    const seq = seqIndices ?? Array.from({ length: steps }, (_, i) => i % iconBuffers.length);
    const jiffyMs = 1000 / 60;
    const stepDurations = seq.map((_, i) => Math.round((rateJiffies?.[i] ?? defaultJiffies) * jiffyMs));

    // ユニークフレームのみデコード（同じバッファを複数ステップで使い回す場合は一度だけデコード）
    const uniqueIndices = [...new Set(seq)];
    const decodedMap = new Map<number, { url: string; hotspot: { x: number; y: number } }>();
    await Promise.all(
        uniqueIndices.map(async (frameIdx) => {
            const d = await _icoToPng(iconBuffers[frameIdx]);
            decodedMap.set(frameIdx, d);
        }),
    );

    hotspot = decodedMap.get(seq[0])?.hotspot ?? { x: 0, y: 0 };

    const frames: AvatarStateFrame[] = seq.map((frameIdx, i) => {
        const decoded = decodedMap.get(frameIdx);
        if (!decoded) {
            throw new Error(`ANI: failed to decode frame index ${frameIdx}`);
        }
        return {
            url: decoded.url,
            duration: stepDurations[i],
        };
    });

    return { url: frames[0].url, hotspot, frames };
}

/**
 * 画像ファイルを読み込み、DecodedImage に変換する。
 *
 * - `.ani` → RIFF を全フレーム＋タイミング解析
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
                .then((buf) => _decodeAni(buf));
        } else if (ext === 'cur' || ext === 'ico') {
            p = fetch(url)
                .then((r) => r.arrayBuffer())
                .then(async (buf) => {
                    const d = await _icoToPng(buf);
                    return { ...d, frames: [{ url: d.url, duration: 100 }] };
                });
        } else {
            p = Promise.resolve({ url, hotspot: { x: 0, y: 0 }, frames: [{ url, duration: 100 }] });
        }
        p.catch((err) => {
            console.error(`[imageLoader] 画像の読み込みに失敗しました: ${url}`, err);
            _cache.delete(url);
        });
        _cache.set(url, p);
    }
    return _cache.get(url) as Promise<DecodedImage>;
}

/**
 * キャッシュ済みの DecodedImage を返す。未キャッシュの場合は undefined。
 * avatarCursorHostBridge がフレームをキャッシュから取り出すために使用する。
 */
export function getCachedImage(url: string): Promise<DecodedImage> | undefined {
    return _cache.get(url);
}
