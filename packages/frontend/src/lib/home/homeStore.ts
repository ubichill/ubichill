/**
 * 自分のホームの設定（ランチパッドの「ホーム」の印・ワールドの詳細・設定画面で共有する）。
 * どこかで変えたら、ほかの表示も同じ値に変わる。
 */
import type { HomeSettingsUpdate, HomeView } from '@ubichill/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { fetchHome, updateHome } from '@/lib/home/homeApi';

export interface HomeState {
    home: HomeView | null;
    loading: boolean;
    error: string | null;
}

const INITIAL: HomeState = { home: null, loading: false, error: null };
const store: { state: HomeState; inflight: Promise<void> | null } = { state: INITIAL, inflight: null };
const listeners = new Set<() => void>();

function setState(next: HomeState): void {
    store.state = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 取得する（取得済み・取得中なら何もしない。force で取り直す）。 */
export function loadHome(force = false): Promise<void> {
    if (store.inflight) return store.inflight;
    if (store.state.home && !force) return Promise.resolve();
    setState({ ...store.state, loading: true, error: null });
    const inflight = fetchHome()
        .then((home) => setState({ home, loading: false, error: null }))
        .catch((e: unknown) =>
            setState({ ...store.state, loading: false, error: e instanceof Error ? e.message : '取得できません' }),
        )
        .finally(() => {
            store.inflight = null;
        });
    store.inflight = inflight;
    return inflight;
}

/** 変える。失敗したら例外（呼んだ画面で理由を出す）。 */
export async function saveHome(update: HomeSettingsUpdate): Promise<HomeView> {
    const home = await updateHome(update);
    setState({ home, loading: false, error: null });
    return home;
}

/** ログアウトしたとき（次の人に前の人の設定を見せない）。 */
export function resetHome(): void {
    setState(INITIAL);
}

export function useHome(): HomeState {
    const state = useSyncExternalStore(subscribe, () => store.state);
    useEffect(() => {
        void loadHome();
    }, []);
    return state;
}
