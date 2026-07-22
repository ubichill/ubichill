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
    const totalCurrentUsers = instances.reduce((sum, i) => sum + i.stats.currentUsers, 0);

    const metaBadges = [
        world?.authorName
            ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:#f5ecdf;border-radius:9999px;border:1px solid #cebca2;font-size:13px;">${userIcon()} 作成者: ${esc(world.authorName)}</span>`
            : '',
        world?.version
            ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:#f5ecdf;border-radius:9999px;border:1px solid #cebca2;font-size:13px;">${tagIcon()} v${esc(world.version)}</span>`
            : '',
        world?.capacity
            ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:#f5ecdf;border-radius:9999px;border:1px solid #cebca2;font-size:13px;">${usersIcon()} 最大 ${world.capacity.max} 人</span>`
            : '',
        instances.length > 0
            ? `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:#f5ecdf;border-radius:9999px;border:1px solid #cebca2;font-size:13px;">${activityIcon()} 現在 ${totalCurrentUsers} 人が遊んでいます</span>`
            : '',
    ]
        .filter(Boolean)
        .join('\n');

    const thumbnail = thumbnailUrl
        ? `<img src="${escAttr(thumbnailUrl)}" alt="${escAttr(title)}" style="width:100%;max-width:576px;height:260px;object-fit:cover;border-radius:24px;box-shadow:0 8px 24px rgba(27,42,68,0.08);" />`
        : '';

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

    const steps = [
        { title: 'アカウントを作る', body: '無料で登録。Google/GitHub でも OK。' },
        { title: 'インスタンスを作成', body: '「新しいインスタンスを作成」で部屋を作る。' },
        { title: 'ワールドに入る', body: 'ブラウザだけで即座に参加。' },
    ];

    const stepsHtml = steps
        .map(
            (step, idx) => `
                <div style="padding:20px;background:#f5ecdf;border:1px solid #cebca2;border-radius:16px;box-shadow:0 8px 24px rgba(27,42,68,0.08);">
                    <span style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:9999px;background:#1b2a44;color:#f8f3ea;font-size:13px;font-weight:700;margin-bottom:12px;">${idx + 1}</span>
                    <h3 style="font-size:16px;font-weight:700;color:#1b2a44;margin:0 0 8px 0;">${esc(step.title)}</h3>
                    <p style="font-size:14px;color:#5e6a82;margin:0;line-height:1.6;">${esc(step.body)}</p>
                </div>`,
        )
        .join('\n');

    return `
        <div data-world-shell style="min-height:100vh;display:flex;flex-direction:column;background:#faf6f0;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <header style="width:100%;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #cebca2;background:#f5ecdf;">
                <a href="${escAttr(publicBaseUrl)}/" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:#1b2a44;">
                    <img src="${escAttr(publicBaseUrl)}/icon.png" alt="" style="width:32px;height:32px;border-radius:8px;" />
                    <span style="font-size:20px;font-weight:700;">ubichill</span>
                </a>
            </header>

            <main style="flex:1;display:flex;flex-direction:column;align-items:center;gap:32px;padding:32px 16px;">
                <section style="width:100%;max-width:768px;display:flex;flex-direction:column;align-items:center;gap:24px;text-align:center;">
                    ${thumbnail}
                    <div style="display:flex;flex-direction:column;gap:12px;align-items:center;">
                        <h1 style="font-size:36px;font-weight:800;color:#1b2a44;line-height:1.2;margin:0;">${esc(title)}</h1>
                        ${world?.description ? `<p style="color:#5e6a82;font-size:18px;max-width:576px;line-height:1.6;margin:0;">${esc(description)}</p>` : ''}
                    </div>

                    <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
                        ${metaBadges}
                    </div>

                    <div style="display:flex;gap:16px;flex-wrap:wrap;justify-content:center;">
                        <button type="button" disabled style="padding:16px 32px;background:#1b2a44;color:#f8f3ea;border-radius:16px;font-weight:700;font-size:18px;border:none;opacity:0.6;cursor:not-allowed;">新しいインスタンスを作成</button>
                        <a href="${escAttr(publicBaseUrl)}/" style="padding:16px 32px;background:#f5ecdf;color:#1b2a44;border-radius:16px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;border:1px solid #cebca2;">ロビーへ戻る</a>
                    </div>
                </section>

                <section style="width:100%;max-width:768px;">
                    <h2 style="font-size:20px;font-weight:700;color:#1b2a44;margin-bottom:16px;text-align:center;">参加までのステップ</h2>
                    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;">
                        ${stepsHtml}
                    </div>
                </section>

                ${
                    instances.length > 0
                        ? `
                <section style="width:100%;max-width:768px;">
                    <h2 style="font-size:20px;font-weight:700;color:#1b2a44;margin-bottom:16px;text-align:center;">参加可能なインスタンス</h2>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        ${instanceItems}
                    </div>
                </section>
                `
                        : ''
                }

                <section style="width:100%;max-width:768px;padding-bottom:32px;">
                    <div style="padding:32px;background:#f5ecdf;border-radius:24px;border:1px solid #cebca2;box-shadow:0 8px 24px rgba(27,42,68,0.08);">
                        <h2 style="font-size:20px;font-weight:700;color:#1b2a44;margin:0 0 12px 0;">ubichill とは？</h2>
                        <p style="color:#5e6a82;line-height:1.8;margin:0 0 16px 0;">
                            ubichill は、URL からワールドを読み込み、ブラウザだけで即座に参加できる 2D メタバース基盤です。
                            自分だけの部屋（インスタンス）を作って、友達やコミュニティと同じ空間を共有できます。
                        </p>
                        <div style="display:flex;gap:16px;flex-wrap:wrap;color:#8a7e6d;font-size:14px;">
                            <span style="display:flex;align-items:center;gap:6px;">${checkIcon()} ブラウザだけで参加</span>
                            <span style="display:flex;align-items:center;gap:6px;">${checkIcon()} 外部ワールドも URL で遊べる</span>
                            <span style="display:flex;align-items:center;gap:6px;">${checkIcon()} リアルタイムカーソル同期</span>
                        </div>
                    </div>
                </section>
            </main>
        </div>
    `.trim();
}

function userIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
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

function checkIcon(): string {
    return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>';
}
