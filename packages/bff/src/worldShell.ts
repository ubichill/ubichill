/**
 * ワールドページの SSR シェル生成。
 *
 * BFF から返す初期 HTML の <body> 内に埋め込み、SEO クローラとユーザーに
 * JavaScript 実行前の内容を提示する。
 *
 * frontend は `createRoot` により起動後にこのシェルを上書きするため、
 * 視覚的なフラッシュを抑えるべく WorldPage.tsx と同等のレイアウトを
 * インラインスタイルで再現する。
 */

import type { Instance, WorldListItem } from '@ubichill/shared';

interface ShellData {
    world: WorldListItem | undefined;
    instances: Instance[];
    publicBaseUrl: string;
    coreApiUrl: string;
}

function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
    return esc(s).replace(/'/g, '&#39;');
}

/**
 * ワールドページの SSR シェル HTML を生成する。
 * @returns ルート要素の HTML（<div id="root"> 内に配置する）
 */
export function renderWorldShell({ world, instances, publicBaseUrl }: ShellData): string {
    const worldId = world?.id ?? '';
    const title = world?.displayName ?? worldId;
    const description = world?.description ?? `${title} — ubichill のワールド`;
    const thumbnailUrl = world?.thumbnail;

    const instanceItems = instances
        .map(
            (i) => `
                <div
                    style="padding: 16px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; text-align: left;"
                >
                    <span style="font-size: 14px; color: rgba(255,255,255,0.6);">
                        参加者 ${i.stats.currentUsers} / ${i.stats.maxUsers}
                    </span>
                </div>`,
        )
        .join('\n');

    const emptyState =
        instances.length === 0
            ? '<p style="color: rgba(255,255,255,0.6); font-size: 14px;">参加可能なインスタンスがありません</p>'
            : '';

    const thumbnail = thumbnailUrl
        ? `<img
                src="${escAttr(thumbnailUrl)}"
                alt="${escAttr(title)}"
                style="width: 100%; max-width: 384px; height: 160px; object-fit: cover; border-radius: 16px;"
           />`
        : '';

    return `
        <div
            data-world-shell
            style="min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px; padding: 32px; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;"
        >
            ${thumbnail}
            <h1 style="font-size: 24px; font-weight: 700; color: #ffffff; margin: 0; text-align: center;">${esc(title)}</h1>
            ${world?.description ? `<p style="color: rgba(255,255,255,0.7); font-size: 14px; text-align: center; max-width: 384px; margin: 0;">${esc(description)}</p>` : ''}

            ${instances.length > 0 ? `<div style="display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 384px;">${instanceItems}</div>` : ''}
            ${emptyState}

            <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center;">
                <button
                    type="button"
                    disabled
                    style="padding: 12px 24px; background: #3b82f6; color: #ffffff; border-radius: 8px; font-weight: 600; text-decoration: none; display: inline-block; border: none; opacity: 0.6; cursor: not-allowed;"
                >新しいインスタンスを作成</button>
                <a
                    href="${escAttr(publicBaseUrl)}/"
                    style="padding: 12px 24px; background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); border-radius: 8px; text-decoration: none; display: inline-block; border: none;"
                >ロビーへ</a>
            </div>
        </div>
    `.trim();
}
