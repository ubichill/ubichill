import type { BlockedUser } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    type BlocksState,
    blockedAuthorsOf,
    blockedIdsOf,
    blocksFailed,
    blocksLoaded,
    blocksLoadPlan,
    INITIAL_BLOCKS_STATE,
} from './blocksState';

const user = (id: string, account: string | null = null): BlockedUser => ({
    id,
    name: id,
    handle: id,
    image: null,
    bio: null,
    blockedAt: '2026-01-01T00:00:00.000Z',
    account,
});
const loaded = (owner: string, blocks: readonly BlockedUser[]): BlocksState => ({ owner, blocks, error: null });

describe('blocksLoadPlan', () => {
    it('初めての持ち主: 空にしてから読む', () => {
        expect(blocksLoadPlan(INITIAL_BLOCKS_STATE, null, 'a', false)).toEqual({
            kind: 'fetch',
            next: { owner: 'a', blocks: null, error: null },
        });
    });

    it('同じ持ち主の読み込みが進んでいれば待つ（2 回読まない）', () => {
        expect(blocksLoadPlan({ owner: 'a', blocks: null, error: null }, 'a', 'a', false)).toEqual({ kind: 'join' });
    });

    it('force なら進んでいる読み込みを待たずに読み直す（ブロックした直後は前の応答が古い）', () => {
        const state = loaded('a', [user('x')]);
        const plan = blocksLoadPlan(state, 'a', 'a', true);
        expect(plan.kind).toBe('fetch');
        // 一覧は捨てない（読み直す間も見えなくしたままにする）
        expect(plan.kind === 'fetch' && plan.next).toBe(state);
    });

    it('読み込み済みなら読まない', () => {
        expect(blocksLoadPlan(loaded('a', []), null, 'a', false)).toEqual({ kind: 'skip' });
    });

    it('前に失敗した（一覧が無い）なら読み直す。エラーは読めるまで残す', () => {
        const failed: BlocksState = { owner: 'a', blocks: null, error: '読み込めません' };
        expect(blocksLoadPlan(failed, null, 'a', false)).toEqual({ kind: 'fetch', next: failed });
    });

    it('持ち主が替わったら、前の人の読み込みが進んでいても前の一覧を捨てて読む', () => {
        expect(blocksLoadPlan(loaded('a', [user('x')]), 'a', 'b', false)).toEqual({
            kind: 'fetch',
            next: { owner: 'b', blocks: null, error: null },
        });
    });
});

describe('blocksLoaded / blocksFailed', () => {
    it('読めたら一覧を入れ、前のエラーを消す', () => {
        const blocks = [user('x')];
        expect(blocksLoaded({ owner: 'a', blocks: null, error: '前の失敗' }, 'a', blocks)).toEqual(loaded('a', blocks));
    });

    it('読んでいる間に持ち主が替わったら、前の人の応答は捨てる', () => {
        const state: BlocksState = { owner: 'b', blocks: null, error: null };
        expect(blocksLoaded(state, 'a', [user('x')])).toBe(state);
        expect(blocksFailed(state, 'a', '失敗')).toBe(state);
    });

    it('ログアウトした（初期の状態）あとに届いた応答も捨てる', () => {
        expect(blocksLoaded(INITIAL_BLOCKS_STATE, 'a', [user('x')])).toBe(INITIAL_BLOCKS_STATE);
    });

    it('読み直しに失敗しても、前に読めた一覧は残す（見えなくした人が見えてしまわない）', () => {
        const blocks = [user('x')];
        expect(blocksFailed(loaded('a', blocks), 'a', '失敗')).toEqual({ owner: 'a', blocks, error: '失敗' });
    });
});

describe('blockedIdsOf / blockedAuthorsOf', () => {
    it('読む前は空', () => {
        expect(blockedIdsOf(INITIAL_BLOCKS_STATE).size).toBe(0);
        expect(blockedAuthorsOf(INITIAL_BLOCKS_STATE).size).toBe(0);
    });

    it('同じ一覧からは同じ Set を返す（描画のたびに作り直さない）', () => {
        const state = loaded('a', [user('x', 'x@example.com')]);
        expect(blockedIdsOf(state)).toBe(blockedIdsOf({ ...state }));
        expect([...blockedIdsOf(state)]).toEqual(['x']);
    });
});
