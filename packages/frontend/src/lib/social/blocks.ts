/**
 * 自分がブロックした人（設定の一覧・プロフィール・部屋の中・mod の読み込みで共有する）。
 * どこかでブロック・解除したら、ほかの表示も同じ一覧に変わる。一覧は持ち主（ログインしているユーザー）ごと。
 * 判定の規則は shared の social/blocks.ts。
 */
import { useEffect, useSyncExternalStore } from 'react';
import {
    type BlocksState,
    blockedIdsOf,
    blocksFailed,
    blocksLoaded,
    blocksLoadPlan,
    INITIAL_BLOCKS_STATE,
} from './blocksState';
import { blockUser, fetchBlocks, unblockUser } from './socialApi';

const store: { state: BlocksState; inflight: { owner: string; promise: Promise<void> } | null } = {
    state: INITIAL_BLOCKS_STATE,
    inflight: null,
};
const listeners = new Set<() => void>();

function setState(next: BlocksState): void {
    if (next === store.state) return;
    store.state = next;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 持ち主の一覧を読む（読み込み済み・読み込み中なら何もしない。force で読み直す）。持ち主が変わったら前の一覧は捨てる。 */
export function loadBlocks(owner: string, force = false): Promise<void> {
    const plan = blocksLoadPlan(store.state, store.inflight?.owner ?? null, owner, force);
    if (plan.kind === 'join' && store.inflight) return store.inflight.promise;
    if (plan.kind !== 'fetch') return Promise.resolve();
    setState(plan.next);
    const promise = fetchBlocks()
        .then(({ blocks }) => setState(blocksLoaded(store.state, owner, blocks)))
        .catch((e: unknown) =>
            setState(blocksFailed(store.state, owner, e instanceof Error ? e.message : '読み込めません')),
        )
        .finally(() => {
            if (store.inflight?.promise === promise) store.inflight = null;
        });
    store.inflight = { owner, promise };
    return promise;
}

/** ブロックして一覧を読み直す。失敗したら例外（呼んだ画面で理由を出す）。 */
export async function blockAndReload(owner: string, userId: string): Promise<void> {
    await blockUser(userId);
    await loadBlocks(owner, true);
}

export async function unblockAndReload(owner: string, userId: string): Promise<void> {
    await unblockUser(userId);
    await loadBlocks(owner, true);
}

/** ログアウトしたとき（次の人に前の人の一覧を使わない）。 */
export function resetBlocks(): void {
    store.inflight = null;
    setState(INITIAL_BLOCKS_STATE);
}

/** 持ち主の一覧（無ければ読みにいく）。ログインしていなければ読まない。 */
export function useBlocks(owner: string | undefined): BlocksState {
    const state = useSyncExternalStore(subscribe, () => store.state);
    useEffect(() => {
        if (owner) void loadBlocks(owner);
    }, [owner]);
    return owner && state.owner === owner ? state : INITIAL_BLOCKS_STATE;
}

/** いま読み込んである一覧から、見えなくする人（読み込みは始めない。部屋の中の表示に使う）。 */
export function useBlockedIds(): ReadonlySet<string> {
    return blockedIdsOf(useSyncExternalStore(subscribe, () => store.state));
}
