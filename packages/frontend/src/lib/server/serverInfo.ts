/**
 * サーバーの情報とブランディング（`GET /api/v1/server`）。起動したときに 1 回読み、紹介のページ・ワールドのページの見出し・
 * コントロールパネルで共有する。管理者が変えたら、ここを置き換えれば画面の色もすぐ変わる。
 */
import {
    type ServerBranding,
    type ServerInfo,
    type ServerOverview,
    THEME_STYLE_ELEMENT_ID,
    themeStyleSheet,
    type WorldListItem,
} from '@ubichill/shared';
import { useSyncExternalStore } from 'react';
import { API_BASE } from '../api';
import { errorMessage } from '../apiError';

/** null は読み込み中、'failed' は読めなかった */
export type ServerOverviewState = ServerOverview | 'failed' | null;

const store: { state: ServerOverviewState; inflight: Promise<void> | null } = { state: null, inflight: null };
const listeners = new Set<() => void>();

/**
 * 主な色を画面に掛ける。BFF が HTML に入れた `<style>` を書き換える（無ければ作る）ので、既定に戻すときも
 * BFF が入れた前の色が残らない。
 */
function applyThemeColor(color: string | null): void {
    const existing = document.getElementById(THEME_STYLE_ELEMENT_ID);
    const element = existing ?? document.head.appendChild(document.createElement('style'));
    element.id = THEME_STYLE_ELEMENT_ID;
    element.textContent = color ? themeStyleSheet(color) : '';
}

function setState(next: ServerOverviewState): void {
    store.state = next;
    if (next && next !== 'failed') applyThemeColor(next.branding?.themeColor ?? null);
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export async function fetchServerOverview(): Promise<ServerOverview> {
    const res = await fetch(`${API_BASE}/api/v1/server`);
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as ServerOverview;
}

/** 読む（読んだ・読んでいる途中なら何もしない）。 */
export function loadServerOverview(): Promise<void> {
    if (store.inflight) return store.inflight;
    if (store.state !== null && store.state !== 'failed') return Promise.resolve();
    const inflight = fetchServerOverview()
        .then(setState)
        .catch(() => setState('failed'))
        .finally(() => {
            store.inflight = null;
        });
    store.inflight = inflight;
    return inflight;
}

export function useServerOverview(): ServerOverviewState {
    return useSyncExternalStore(subscribe, () => store.state);
}

/** 管理者が変えた後のブランディングを画面に出す（読めていなければ、読み直す）。 */
export function setServerBranding(branding: ServerBranding): void {
    if (store.state && store.state !== 'failed') setState({ ...store.state, branding });
    else void loadServerOverview();
}

/** 管理者が変えた後のサーバーの情報を画面に出す。 */
export function setServerInfo(info: ServerInfo): void {
    if (store.state && store.state !== 'failed') setState({ ...store.state, info });
}

/** 狭い場所に出す名前（略称。無ければサーバー名） */
export const shortNameOf = (overview: ServerOverview): string => overview.branding?.shortName || overview.info.name;

/** 紹介のページに並べる、このサーバーのワールド（ログインしなくても読める）。 */
export async function fetchLocalWorlds(): Promise<WorldListItem[]> {
    const res = await fetch(`${API_BASE}/api/v1/worlds?scope=local`);
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { worlds: WorldListItem[] }).worlds;
}
