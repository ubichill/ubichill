/**
 * ブロックした人の一覧のストア（lib/blocks.ts）の状態遷移。読み込みの副作用は blocks.ts が持ち、ここは決めるだけ。
 */
import { type BlockedUser, blockedAuthorKeys } from '@ubichill/shared';

export interface BlocksState {
    owner: string | null;
    /** 読み込む前は null */
    blocks: readonly BlockedUser[] | null;
    error: string | null;
}

export const INITIAL_BLOCKS_STATE: BlocksState = { owner: null, blocks: null, error: null };

/**
 * 読み込みを頼まれたときにすること。
 * - join: 同じ持ち主の読み込みが進んでいる（force でなければ、それを待つ）
 * - skip: 読み込み済み（force でなければ読まない）
 * - fetch: 読みにいく。持ち主が替わったら前の人の一覧は捨ててから（next）
 */
export type BlocksLoadPlan = { kind: 'join' } | { kind: 'skip' } | { kind: 'fetch'; next: BlocksState };

export function blocksLoadPlan(
    state: BlocksState,
    inflightOwner: string | null,
    owner: string,
    force: boolean,
): BlocksLoadPlan {
    if (inflightOwner === owner && !force) return { kind: 'join' };
    if (state.owner !== owner) return { kind: 'fetch', next: { owner, blocks: null, error: null } };
    if (state.blocks && !force) return { kind: 'skip' };
    return { kind: 'fetch', next: state };
}

/** 読めたとき。読んでいる間に持ち主が替わっていたら（ログアウト・別の人）何も変えない。 */
export const blocksLoaded = (state: BlocksState, owner: string, blocks: readonly BlockedUser[]): BlocksState =>
    state.owner === owner ? { owner, blocks, error: null } : state;

/** 読めなかったとき。前に読めた一覧は残す。持ち主が替わっていたら何も変えない。 */
export const blocksFailed = (state: BlocksState, owner: string, error: string): BlocksState =>
    state.owner === owner ? { ...state, error } : state;

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
