/**
 * avatarTemplateLoader
 *
 * アバタープラグイン用のテンプレートローダー。
 * ANI/ICO → PNG data URL 変換、manifest.json キャッシュを担当。
 * InstanceRenderer から切り離してモジュール単位でキャッシュを保持する。
 */

import { parseICO } from 'icojs/browser';

export interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

export type AvatarStates = Record<string, { url: string; hotspot: { x: number; y: number } }>;

// ── モジュールレベルキャッシュ ─────────────────────────────────────

let _manifestPromise: Promise<TemplateEntry[]> | null = null;

function _getManifest(): Promise<TemplateEntry[]> {
    if (!_manifestPromise) {
        _manifestPromise = fetch('/plugins/avatar/templates/manifest.json')
            .then((r) => r.json() as Promise<TemplateEntry[]>)
            .catch((e) => {
                _manifestPromise = null;
                throw e;
            });
    }
    return _manifestPromise;
}

const _templateCache = new Map<string, Promise<AvatarStates>>();

async function _aniToDataUrl(url: string): Promise<{ url: string; hotspot: { x: number; y: number } }> {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    const view = new DataView(buffer);
    let offset = 12;
    let icoBuffer: ArrayBuffer | null = null;
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
            icoBuffer = buffer.slice(offset + 8, offset + 8 + chunkSize);
            break;
        }
        offset += 8 + chunkSize + (chunkSize % 2);
    }
    if (!icoBuffer) throw new Error(`ANI parse failed: ${url}`);
    const images = await parseICO(icoBuffer, 'image/png');
    if (!images.length) throw new Error(`ICO parse failed: ${url}`);
    const best = images.reduce((a, b) => (a.width >= b.width ? a : b));
    const bytes = new Uint8Array(best.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return { url: `data:image/png;base64,${btoa(binary)}`, hotspot: { x: 0, y: 0 } };
}

let _thumbnailsPromise: Promise<Record<string, string>> | null = null;

export function buildAvatarThumbnails(): Promise<Record<string, string>> {
    if (!_thumbnailsPromise) {
        _thumbnailsPromise = _getManifest()
            .then(async (templates) => {
                const thumbnails: Record<string, string> = {};
                await Promise.all(
                    templates.map(async (t) => {
                        const defaultFile = t.mappings?.default;
                        if (!defaultFile) return;
                        const fileUrl = `/plugins/avatar/templates/${t.directory}/${defaultFile}`;
                        try {
                            thumbnails[t.id] = defaultFile.endsWith('.ani')
                                ? (await _aniToDataUrl(fileUrl)).url
                                : fileUrl;
                        } catch {
                            // 変換失敗はスキップ
                        }
                    }),
                );
                return thumbnails;
            })
            .catch((e) => {
                _thumbnailsPromise = null;
                throw e;
            });
    }
    return _thumbnailsPromise;
}

export function loadAvatarTemplate(templateId: string): Promise<AvatarStates> {
    if (!_templateCache.has(templateId)) {
        const p = _getManifest().then(async (templates) => {
            const template = templates.find((t) => t.id === templateId);
            if (!template) throw new Error(`Template not found: ${templateId}`);
            const states: AvatarStates = {};
            await Promise.all(
                Object.entries(template.mappings).map(async ([state, filename]) => {
                    if (!filename) return;
                    const fileUrl = `/plugins/avatar/templates/${template.directory}/${filename}`;
                    states[state] = filename.endsWith('.ani')
                        ? await _aniToDataUrl(fileUrl)
                        : { url: fileUrl, hotspot: { x: 0, y: 0 } };
                }),
            );
            return states;
        });
        p.catch(() => _templateCache.delete(templateId));
        _templateCache.set(templateId, p);
    }
    const cached = _templateCache.get(templateId);
    if (!cached) throw new Error(`Template cache missing: ${templateId}`);
    return cached;
}
