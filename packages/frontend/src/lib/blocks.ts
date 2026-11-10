/**
 * 自分がブロックした人（設定の一覧・プロフィール・部屋の中・mod の読み込みで共有する）。
 * どこかでブロック・解除したら、ほかの表示も同じ一覧に変わる。一覧は持ち主（ログインしているユーザー）ごと。
 * 判定の規則は shared の user/blocks.ts。
 */
import { type BlockedUser, blockedAuthorKeys } from '@ubichill/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { blockUser, fetchBlocks, unblockUser } from './socialApi';

export interface BlocksState {
    owner: string | null;
    /** 読み込む前は null */
    blocks: readonly BlockedUser[] | null;
    error: string | null;
}

const INITIAL: BlocksState = { owner: null, blocks: null, error: null };
const store: { state: BlocksState; inflight: { owner: string; promise: Promise<void> } | null } = {
    state: INITIAL,
    inflight: null,
};
const listeners = new Set<() => void>();

function setState(next: BlocksState): void {
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
    if (store.inflight?.owner === owner && !force) return store.inflight.promise;
    if (store.state.owner !== owner) setState({ owner, blocks: null, error: null });
    else if (store.state.blocks && !force) return Promise.resolve();
    const promise = fetchBlocks()
        .then(({ blocks }) => {
            if (store.state.owner === owner) setState({ owner, blocks, error: null });
        })
        .catch((e: unknown) => {
            if (store.state.owner === owner)
                setState({ ...store.state, error: e instanceof Error ? e.message : '読み込めません' });
        })
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
    setState(INITIAL);
}

/** 持ち主の一覧（無ければ読みにいく）。ログインしていなければ読まない。 */
export function useBlocks(owner: string | undefined): BlocksState {
    const state = useSyncExternalStore(subscribe, () => store.state);
    useEffect(() => {
        if (owner) void loadBlocks(owner);
    }, [owner]);
    return owner && state.owner === owner ? state : INITIAL;
}

const EMPTY: ReadonlySet<string> = new Set();
const derived = new WeakMap<readonly BlockedUser[], { ids: ReadonlySet<string>; authors: ReadonlySet<string> }>();

function derive(blocks: readonly BlockedUser[] | null) {
    if (!blocks) return { ids: EMPTY, authors: EMPTY };
    const cached = derived.get(blocks);
    if (cached) return cached;
    const next = { ids: new Set(blocks.map((b) => b.id)), authors: blockedAuthorKeys(blocks.map((b) => b.account)) };
    derived.set(blocks, next);
    return next;
}

/** 見えなくする人（自分がブロックした人の ID）。 */
export const blockedIdsOf = (state: BlocksState): ReadonlySet<string> => derive(state.blocks).ids;

/** 読み込まない mod の作者アカウント（突き合わせる形にしたもの）。 */
export const blockedAuthorsOf = (state: BlocksState): ReadonlySet<string> => derive(state.blocks).authors;

/** いま読み込んである一覧から、見えなくする人（読み込みは始めない。部屋の中の表示に使う）。 */
export function useBlockedIds(): ReadonlySet<string> {
    return blockedIdsOf(useSyncExternalStore(subscribe, () => store.state));
}
