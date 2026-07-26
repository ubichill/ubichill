/**
 * ワールドページの SSR シェル生成。
 *
 * BFF から返す初期 HTML の <body> 内に埋め込み、SEO クローラとユーザーに
 * JavaScript 実行前の内容を提示する。
 *
 * frontend は `createRoot` により起動後にこのシェルを上書きするため、
 * 視覚的なフラッシュを抑えるべく WorldPage.tsx と同等のレイアウトを
 * インラインスタイルで再現する。
 *
 * BFF は Node/Express で PandaCSS ランタイムを持てないため、ここは
 * ハイドレーション前の一時表示に限りパレットを複製する。意図が読めるよう
 * 生の hex を散らさず `C` に名前付けする。frontend のトークンと乖離したら
 * ここも追従する（一時シェルなので厳密一致は不要）。
 */

import { type Instance, type WorldListItem, worldSourceLabel } from '@ubichill/shared';
import { esc } from './html';

/** SSR シェル専用パレット（frontend の PandaCSS トークンの近似複製）。 */
const C = {
    pageBg: '#faf6f0',
    surface: '#f5ecdf',
    border: '#cebca2',
    text: '#1b2a44',
    textMuted: '#5e6a82',
    textSubtle: '#8a7e6d',
    onPrimary: '#f8f3ea',
    shadow: 'rgba(27,42,68,0.08)',
} as const;

interface ShellData {
    world: WorldListItem | undefined;
    instances: Instance[];
    publicBaseUrl: string;
    coreApiUrl: string;
}

function formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// セクション断片ビルダ（各セクションを小さく分離してデバッグしやすく）
// ============================================================

function badge(icon: string, label: string): string {
    return `<span style="display:inline-flex;align-items:center;gap:6px;padding:4px 12px;background:${C.surface};border-radius:9999px;border:1px solid ${C.border};font-size:13px;">${icon} ${esc(label)}</span>`;
}

function metaBadgesFragment(world: WorldListItem | undefined, totalCurrentUsers: number): string {
    return [
        world ? badge(globeIcon(), worldSourceLabel(world.source)) : '',
        world?.version ? badge(tagIcon(), `v${world.version}`) : '',
        world?.capacity ? badge(usersIcon(), `最大 ${world.capacity.max} 人`) : '',
        totalCurrentUsers > 0 ? badge(activityIcon(), `${totalCurrentUsers} 人が接続中`) : '',
    ]
        .filter(Boolean)
        .join('\n');
}

function thumbnailFragment(thumbnailUrl: string | undefined, title: string): string {
    return thumbnailUrl
        ? `<img src="${esc(thumbnailUrl)}" alt="${esc(title)}" style="width:100%;height:100%;object-fit:cover;" />`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:${C.textSubtle};">No thumbnail</div>`;
}

function detailRowsFragment(world: WorldListItem | undefined): string {
    return [
        world?.authorName ? { label: '作成者', value: world.authorName } : null,
        world ? { label: 'バージョン', value: `v${world.version}` } : null,
        world?.capacity
            ? { label: 'キャパシティ', value: `${world.capacity.default}〜${world.capacity.max} 人` }
            : null,
        world ? { label: '由来', value: worldSourceLabel(world.source) } : null,
        formatDate(world?.createdAt) ? { label: '公開日', value: formatDate(world?.createdAt) } : null,
        formatDate(world?.updatedAt) ? { label: '更新日', value: formatDate(world?.updatedAt) } : null,
    ]
        .filter((r): r is { label: string; value: string } => r !== null)
        .map(
            (r) =>
                `<div style="display:flex;justify-content:space-between;gap:16px;font-size:14px;"><span style="color:${C.textSubtle};">${esc(r.label)}</span><span style="color:${C.text};font-weight:500;text-align:right;">${esc(r.value)}</span></div>`,
        )
        .join('\n');
}

function modsFragment(world: WorldListItem | undefined): string {
    if (!world?.mods || world.mods.length === 0) return '';
    const chips = world.mods
        .map(
            (m) =>
                `<span style="padding:4px 8px;background:${C.pageBg};border:1px solid ${C.border};border-radius:4px;font-size:12px;color:${C.textMuted};">${esc(m.id)}${m.version ? ` <span style="color:${C.textSubtle};">v${esc(m.version)}</span>` : ''}</span>`,
        )
        .join('');
    return `<div style="margin-top:16px;"><p style="font-size:12px;color:${C.textSubtle};margin:0 0 8px 0;">使用 mod</p><div style="display:flex;gap:6px;flex-wrap:wrap;">${chips}</div></div>`;
}

function instancesFragment(instances: Instance[]): string {
    if (instances.length === 0) {
        return `<p style="color:${C.textMuted};font-size:14px;margin:0;">現在アクティブなインスタンスはありません。「インスタンスを作成」で新しく作成できます。</p>`;
    }
    const items = instances
        .map(
            (i) => `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:${C.surface};border:1px solid ${C.border};border-radius:16px;">
                    <div style="display:flex;flex-direction:column;gap:4px;">
                        <span style="font-size:14px;font-weight:600;color:${C.text};">${i.status === 'full' ? '満員' : '参加可能'}</span>
                        <span style="font-size:12px;color:${C.textMuted};">${i.access.type === 'public' ? '公開' : '限定'}${i.access.password ? ' · パスワードあり' : ''}</span>
                    </div>
                    <span style="font-size:14px;color:${C.textMuted};font-weight:500;">${i.stats.currentUsers} / ${i.stats.maxUsers} 人</span>
                </div>`,
        )
        .join('\n');
    return `<div style="display:flex;flex-direction:column;gap:12px;">${items}</div>`;
}

function headerFragment(publicBaseUrl: string): string {
    return `
            <header style="width:100%;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${C.border};background:${C.surface};">
                <a href="${esc(publicBaseUrl)}/" style="display:flex;align-items:center;gap:12px;text-decoration:none;color:${C.text};">
                    <img src="${esc(publicBaseUrl)}/icon.png" alt="" style="width:32px;height:32px;border-radius:8px;" />
                    <span style="font-size:20px;font-weight:700;">ubichill</span>
                </a>
            </header>`;
}

function heroFragment(
    world: WorldListItem | undefined,
    title: string,
    thumbnailUrl: string | undefined,
    totalCurrentUsers: number,
    publicBaseUrl: string,
): string {
    return `
                <section style="display:flex;flex-direction:column;gap:20px;">
                    <div style="width:100%;aspect-ratio:16 / 9;max-height:460px;border-radius:24px;overflow:hidden;background:${C.surface};border:1px solid ${C.border};box-shadow:0 8px 24px ${C.shadow};">
                        ${thumbnailFragment(thumbnailUrl, title)}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:12px;">
                        <h1 style="font-size:36px;font-weight:800;color:${C.text};line-height:1.2;margin:0;word-break:break-word;">${esc(title)}</h1>
                        ${world?.authorName ? `<p style="color:${C.textMuted};font-size:16px;margin:0;">作成者: <span style="color:${C.text};font-weight:600;">${esc(world.authorName)}</span></p>` : ''}
                        <div style="display:flex;gap:12px;flex-wrap:wrap;">${metaBadgesFragment(world, totalCurrentUsers)}</div>
                    </div>
                    <div style="display:flex;gap:16px;flex-wrap:wrap;">
                        <button type="button" disabled style="padding:16px 32px;background:${C.text};color:${C.onPrimary};border-radius:16px;font-weight:700;font-size:18px;border:none;opacity:0.6;cursor:not-allowed;">インスタンスを作成</button>
                        <a href="${esc(publicBaseUrl)}/" style="padding:16px 32px;background:${C.surface};color:${C.text};border-radius:16px;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;border:1px solid ${C.border};">ロビーへ戻る</a>
                    </div>
                </section>`;
}

function detailsFragment(world: WorldListItem | undefined): string {
    return `
                <section style="display:grid;grid-template-columns:2fr 1fr;gap:24px;align-items:start;">
                    <div>
                        <h2 style="font-size:18px;font-weight:700;color:${C.text};margin:0 0 12px 0;">説明</h2>
                        <p style="color:${C.textMuted};line-height:1.8;margin:0;white-space:pre-wrap;">${world?.description ? esc(world.description) : '説明はありません。'}</p>
                    </div>
                    <div style="background:${C.surface};border:1px solid ${C.border};border-radius:16px;padding:20px;box-shadow:0 8px 24px ${C.shadow};">
                        <h2 style="font-size:16px;font-weight:700;color:${C.text};margin:0 0 12px 0;">詳細</h2>
                        <div style="display:flex;flex-direction:column;gap:12px;">${detailRowsFragment(world)}</div>
                        ${modsFragment(world)}
                    </div>
                </section>`;
}

function footerFragment(): string {
    return `
                <section style="margin-top:16px;padding-top:24px;border-top:1px solid ${C.border};color:${C.textSubtle};font-size:14px;line-height:1.7;">
                    <p style="margin:0;"><span style="font-weight:700;color:${C.textMuted};">ubichill</span> は URL からワールドを読み込み、ブラウザだけで即座に参加できる 2D メタバース基盤です。「インスタンスを作成」で自分の部屋（インスタンス）を作って参加できます（要ログイン）。</p>
                </section>`;
}

/**
 * ワールドページの SSR シェル HTML を生成する。
 * @returns ルート要素の HTML（<div id="root"> 内に配置する）
 */
export function renderWorldShell({ world, instances, publicBaseUrl }: ShellData): string {
    const title = world?.displayName ?? world?.id ?? '';
    const thumbnailUrl = world?.thumbnail;
    const totalCurrentUsers = instances.reduce((sum, i) => sum + i.stats.currentUsers, 0);

    return `
        <div data-world-shell style="min-height:100vh;display:flex;flex-direction:column;background:${C.pageBg};font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            ${headerFragment(publicBaseUrl)}
            <main style="flex:1;width:100%;max-width:1024px;margin:0 auto;display:flex;flex-direction:column;gap:32px;padding:32px 16px;">
                ${heroFragment(world, title, thumbnailUrl, totalCurrentUsers, publicBaseUrl)}
                ${detailsFragment(world)}
                <section>
                    <h2 style="font-size:18px;font-weight:700;color:${C.text};margin:0 0 16px 0;">参加可能なインスタンス</h2>
                    ${instancesFragment(instances)}
                </section>
                ${footerFragment()}
            </main>
        </div>
    `.trim();
}

// ============================================================
// アイコン（インライン SVG）
// ============================================================

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
