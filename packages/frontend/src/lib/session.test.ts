import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-client', () => ({ useSession: () => null }));

const { nextLastGoodSession, resilientSession } = await import('./session');

type Raw = Parameters<typeof resilientSession>[0];
type Data = NonNullable<Raw['data']>;

const alice = { user: { id: 'alice' }, session: { id: 's1' } } as unknown as Data;
const bob = { user: { id: 'bob' }, session: { id: 's2' } } as unknown as Data;
const refetch = async () => {};
const state = (over: Partial<Raw>): Raw => ({
    data: null,
    error: null,
    isPending: false,
    isRefetching: false,
    refetch,
    ...over,
});
const serverError = { status: 503, statusText: 'Service Unavailable' } as Raw['error'];
const networkError = new TypeError('Failed to fetch') as unknown as Raw['error'];
const unauthorized = { status: 401, statusText: 'Unauthorized' } as Raw['error'];

/** 届いた状態を順に流し、配った data の列を返す（SessionProvider と同じ順で直近のセッションを覚える）。 */
const run = (raws: Raw[]): Array<Raw['data']> =>
    raws.reduce<{ last: Raw['data']; out: Array<Raw['data']> }>(
        ({ last, out }, raw) => {
            const nextLast = nextLastGoodSession(raw, last);
            return { last: nextLast, out: [...out, resilientSession(raw, nextLast).data] };
        },
        { last: null, out: [] },
    ).out;

describe('SessionProvider の直近のセッション', () => {
    it('一過性の失敗（5xx・通信の失敗）の間は直近のセッションを配り続ける', () => {
        expect(run([state({ data: alice }), state({ error: serverError }), state({ error: networkError })])).toEqual([
            alice,
            alice,
            alice,
        ]);
    });

    it('ログアウト後（サーバーが未認証と答えた後）の一過性の失敗で、前の人のセッションを返さない', () => {
        expect(run([state({ data: alice }), state({}), state({ error: serverError })])).toEqual([alice, null, null]);
    });

    it('401 の後の一過性の失敗でも、前の人のセッションを返さない', () => {
        expect(run([state({ data: alice }), state({ error: unauthorized }), state({ error: serverError })])).toEqual([
            alice,
            null,
            null,
        ]);
    });

    it('読み込み中（isPending）は直近のセッションを忘れない', () => {
        expect(run([state({ data: alice }), state({ isPending: true }), state({ error: serverError })])).toEqual([
            alice,
            null,
            alice,
        ]);
    });

    it('別の人がログインしたら、その人のセッションを覚える', () => {
        expect(run([state({ data: alice }), state({}), state({ data: bob }), state({ error: serverError })])).toEqual([
            alice,
            null,
            bob,
            bob,
        ]);
    });

    it('一度もセッションが無いまま失敗しても、何も作らない', () => {
        expect(run([state({ error: serverError }), state({ error: networkError })])).toEqual([null, null]);
    });

    it('一過性の失敗で直近のセッションを配るときは error を消す（ログアウト扱いにしない）', () => {
        const raw = state({ error: serverError });
        expect(resilientSession(raw, alice)).toMatchObject({ data: alice, error: null });
    });
});
