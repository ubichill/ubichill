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
/** WorldSource から人間向けの由来ラベルを作る（WorldPage.tsx と同義）。 */
function sourceLabel(source: WorldListItem['source']): string {
    switch (source.kind) {
        case 'local':
            return 'このインスタンス';
        case 'github':
            return source.registryName ? `GitHub: ${source.registryName}` : 'GitHub';
        case 'remote-instance':
            try {
                return source.originInstance ? `外部: ${new URL(source.originInstance).host}` : '外部インスタンス';
            } catch {
                return '外部インスタンス';
            }
        case 'registry':
            return source.registryName ?? 'レジストリ';
        default:
            return '外部 URL';
    }
}

function formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export function renderWorldShell({ world, instances, publicBaseUrl }: ShellData): string {
    const worldId = world?.id ?? '';
    const title = world?.displayName ?? worldId;
    const thumbnailUrl = world?.thumbnail;
    const totalCurrentUsers = instances.reduce((sum, i) => sum + i.stats.currentUsers, 0);

    const badge = (icon: string, label: string): string =>
        `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:#f5ecdf;border-radius:9999px;border:1px solid #cebca2;font-size:13px;">${icon} ${esc(label)}</span>`;
    const metaBadges = [
        world ? badge(globeIcon(), sourceLabel(world.source)) : '',
        world?.version ? badge(tagIcon(), `v${world.version}`) : '',
        world?.capacity ? badge(usersIcon(), `最大 ${world.capacity.max} 人`) : '',
        totalCurrentUsers > 0 ? badge(activityIcon(), `${totalCurrentUsers} 人が接続中`) : '',
    ]
        .filter(Boolean)
        .join('\n');

    const thumbnail = thumbnailUrl
        ? `<img src="${escAttr(thumbnailUrl)}" alt="${escAttr(title)}" style="width:100%;height:100%;object-fit:cover;" />`
        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8a7e6d;">No thumbnail</div>';

    const detailRows = [
        world?.authorName ? { label: '作成者', value: world.authorName } : null,
        world ? { label: 'バージョン', value: `v${world.version}` } : null,
        world?.capacity
            ? { label: 'キャパシティ', value: `${world.capacity.default}〜${world.capacity.max} 人` }
            : null,
        world ? { label: '由来', value: sourceLabel(world.source) } : null,
        formatDate(world?.createdAt) ? { label: '公開日', value: formatDate(world?.createdAt) } : null,
        formatDate(world?.updatedAt) ? { label: '更新日', value: formatDate(world?.updatedAt) } : null,
    ]
        .filter((r): r is { label: string; value: string } => r !== null)
        .map(
            (r) =>
                `<div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;"><span style="color:#8a7e6d;">${esc(r.label)}</span><span style="color:#1b2a44;font-weight:500;text-align:right;">${esc(r.value)}</span></div>`,
        )
        .join('\n');

    const instanceItems = instances
        .map(
            (i) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:#f5ecdf;border:1px solid #cebca2;border-radius:16px;">
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <span style="font-size:14px;font-weight:600;color:#1b2a44;">${i.status === 'full' ? '満員' : '参加可能'}</span>
                        <span style="font-size:12px;color:#5e6a82;">${i.access.type === 'public' ? '公開' : '限定'}${i.access.password ? ' · パスワードあり' : ''}</span>
                    </div>
                    <span style="font-size:14px;color:#5e6a82;font-weight:500;">${i.stats.currentUsers} / ${i.stats.maxUsers} 人</span>
                </div>`,
        )
        .join('\n');

    const instancesBlock =
        instances.length > 0
            ? `<div style="display:flex;flex-direction:column;gap:12px;">${instanceItems}</div>`
            : '<p style="color:#5e6a82;font-size:14px;margin:0;">現在アクティブなインスタンスはありません。「このワールドに入る」で新しく作成できます。</p>';

    return `
        <div data-world-shell style="min-height:100vh;display:flex;flex-direction:column;background:#faf6f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <header style="width:100%;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cebca2;background:#f5ecdf;">
                <a href="${escAttr(publicBaseUrl)}/" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:#1b2a44;">
                    <img src="${escAttr(publicBaseUrl)}/icon.png" alt="" style="width:32px;height:32px;border-radius:8px;" />
                    <span style="font-size:20px;font-weight:700;">ubichill</span>
                </a>
            </header>

            <main style="flex:1;width:100%;max-width:1024px;margin:0 auto;display:flex;flex-direction:column;gap:32px;padding:32px 16px;">
                <section style="display:flex;flex-direction:column;gap:20px;">
                    <div style="width:100%;aspect-ratio:16 / 9;max-height:460px;border-radius:24px;overflow:hidden;background:#f5ecdf;border:1px solid #cebca2;box-shadow:0 8px 24px rgba(27,42,68,0.08);">
                        ${thumbnail}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <h1 style="font-size:36px;font-weight:800;color:#1b2a44;line-height:1.2;margin:0;word-break:break-word;">${esc(title)}</h1>
                        ${world?.authorName ? `<p style="color:#5e6a82;font-size:16px;margin:0;">作成者: <span style="color:#1b2a44;font-weight:600;">${esc(world.authorName)}</span></p>` : ''}
                        <div style="display:flex;gap:12px;flex-wrap:wrap;">${metaBadges}</div>
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;">
                        <button type="button" disabled style="padding:16px 32px;background:#1b2a44;color:#f8f3ea;border-radius:16px;font-weight:700;font-size:18px;border:none;opacity:0.6;cursor:not-allowed;">このワールドに入る</button>
                        <a href="${escAttr(publicBaseUrl)}/" style="padding:16px 32px;background:#f5ecdf;color:#1b2a44;border-radius:16px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;border:1px solid #cebca2;">ロビーへ戻る</a>
                    </div>
                </section>

                <section style="display:grid;grid-template-columns:2fr 1fr;gap:24px;align-items:start;">
                    <div>
                        <h2 style="font-size:18px;font-weight:700;color:#1b2a44;margin:0 0 12px 0;">説明</h2>
                        <p style="color:#5e6a82;line-height:1.8;margin:0;white-space:pre-wrap;">${world?.description ? esc(world.description) : '説明はありません。'}</p>
                    </div>
                    <div style="background:#f5ecdf;border:1px solid #cebca2;border-radius:16px;padding:20px;box-shadow:0 8px 24px rgba(27,42,68,0.08);">
                        <h2 style="font-size:16px;font-weight:700;color:#1b2a44;margin:0 0 12px 0;">詳細</h2>
                        <div style="display:flex;flex-direction:column;gap:12px;">${detailRows}</div>
                    </div>
                </section>

                <section>
                    <h2 style="font-size:18px;font-weight:700;color:#1b2a44;margin:0 0 16px 0;">参加可能なインスタンス</h2>
                    ${instancesBlock}
                </section>

                <section style="margin-top:16px;padding-top:24px;border-top:1px solid #cebca2;color:#8a7e6d;font-size:14px;line-height:1.7;">
                    <p style="margin:0;"><span style="font-weight:700;color:#5e6a82;">ubichill</span> は URL からワールドを読み込み、ブラウザだけで即座に参加できる 2D メタバース基盤です。「このワールドに入る」で自分の部屋（インスタンス）を作って参加できます（要ログイン）。</p>
                </section>
            </main>
        </div>
    `.trim();
}

function globeIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>';
}

function tagIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r="2"/></svg>';
}

function usersIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
}

function activityIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
}
