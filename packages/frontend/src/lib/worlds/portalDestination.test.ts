import { describe, expect, it, vi } from 'vitest';
import {
    createPortalLookup,
    type PortalRoomSource,
    portalWorldRef,
    ROOM_STATUS_TTL_MS,
    UNKNOWN_ROOM,
} from './portalDestination';

describe('portalWorldRef', () => {
    it('行き先の種類ごとに、ワールドを引く参照にする', () => {
        expect(portalWorldRef({ kind: 'share', path: '@youkan/garden' })).toBe('@youkan/garden');
        expect(portalWorldRef({ kind: 'id', id: 'abc123' })).toBe('abc123');
        expect(portalWorldRef({ kind: 'url', url: 'https://example.com/w.yaml' })).toBe('https://example.com/w.yaml');
    });
});

describe('createPortalLookup', () => {
    it('名前とサムネイルを返し、同じ行き先は 1 回だけ引く', async () => {
        const fetchWorld = vi.fn(async () => ({ displayName: '庭', thumbnail: 'https://example.com/t.png' }));
        const lookup = createPortalLookup(fetchWorld);
        const target = { kind: 'share', path: '@youkan/garden' } as const;
        const [a, b] = await Promise.all([lookup(target), lookup(target)]);
        expect(a).toEqual({ name: '庭', thumbnail: 'https://example.com/t.png' });
        expect(b).toBe(a);
        expect(fetchWorld).toHaveBeenCalledTimes(1);
    });

    it('サムネイルの無い（必須にする前に公開された）ワールドは名前だけ', async () => {
        const lookup = createPortalLookup(async () => ({ displayName: '古いワールド' }));
        expect(await lookup({ kind: 'id', id: 'old' })).toEqual({ name: '古いワールド' });
    });

    it('引けなければ null を返し、何度も問い合わせない', async () => {
        const fetchWorld = vi.fn(async () => {
            throw new Error('World not found');
        });
        const lookup = createPortalLookup(fetchWorld);
        expect(await lookup({ kind: 'id', id: 'gone' })).toBeNull();
        expect(await lookup({ kind: 'id', id: 'gone' })).toBeNull();
        expect(fetchWorld).toHaveBeenCalledTimes(1);
    });

    describe('部屋へのポータル', () => {
        const room = () => ({
            world: { id: 'w', displayName: 'カフェ', thumbnail: 'https://example.com/cafe.png' },
            canJoin: true,
            leaderId: 'leader',
            stats: { currentUsers: 2, maxUsers: 10 },
        });
        const source = (fetch: PortalRoomSource['fetch'], viewerId: string | null = 'me'): PortalRoomSource => ({
            fetch,
            viewerId,
        });

        it('部屋のワールドの名前とサムネイルを返し、同じ部屋は 1 回だけ引く', async () => {
            const fetchRoom = vi.fn(async () => room());
            const lookup = createPortalLookup(vi.fn(), source(fetchRoom));
            const goal = { kind: 'room', room: 'abc' } as const;
            const [a, b] = await Promise.all([lookup(goal), lookup(goal)]);
            expect(a).toEqual({ name: 'カフェ', thumbnail: 'https://example.com/cafe.png' });
            expect(b).toBe(a);
            expect(fetchRoom).toHaveBeenCalledTimes(1);
            expect(fetchRoom).toHaveBeenCalledWith('abc', expect.any(AbortSignal));
        });

        it('入れない部屋（公開範囲・招待）と満員の部屋は locked', async () => {
            const closed = createPortalLookup(
                vi.fn(),
                source(async () => ({ ...room(), canJoin: false })),
            );
            expect(await closed({ kind: 'room', room: 'a' })).toMatchObject({ locked: true });
            const full = createPortalLookup(
                vi.fn(),
                source(async () => ({ ...room(), stats: { currentUsers: 10, maxUsers: 10 } })),
            );
            expect(await full({ kind: 'room', room: 'b' })).toMatchObject({ locked: true });
        });

        it('満員でも、部屋を作った人には locked にしない（作った人は満員でも入れる）', async () => {
            const lookup = createPortalLookup(
                vi.fn(),
                source(async () => ({ ...room(), stats: { currentUsers: 10, maxUsers: 10 } }), 'leader'),
            );
            expect(await lookup({ kind: 'room', room: 'a' })).not.toHaveProperty('locked');
        });

        it('無い・見えない部屋は null。部屋とワールドの同じ文字列を取り違えない', async () => {
            const fetchWorld = vi.fn(async () => ({ displayName: 'abc という名前のワールド' }));
            const lookup = createPortalLookup(
                fetchWorld,
                source(async () => null),
            );
            expect(await lookup({ kind: 'room', room: 'abc' })).toBeNull();
            expect(await lookup({ kind: 'id', id: 'abc' })).toEqual({ name: 'abc という名前のワールド' });
        });

        describe('入れるかの引き直し', () => {
            const clock = () => {
                const t = { now: 0 };
                return {
                    now: () => t.now,
                    advance: (ms: number) => {
                        t.now += ms;
                    },
                };
            };
            const goal = { kind: 'room', room: 'abc' } as const;
            const users = (n: number) => ({ ...room(), stats: { currentUsers: n, maxUsers: 10 } });

            it('満員だった部屋は、空きができれば次に引いたとき鍵が外れる（満員を覚え続けない）', async () => {
                const c = clock();
                const fetchRoom = vi.fn(async () => users(10));
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now });
                expect(await lookup(goal)).toMatchObject({ locked: true });
                fetchRoom.mockResolvedValue(users(9));
                c.advance(ROOM_STATUS_TTL_MS - 1);
                expect(await lookup(goal)).toMatchObject({ locked: true });
                c.advance(1);
                expect(await lookup(goal)).not.toHaveProperty('locked');
                expect(fetchRoom).toHaveBeenCalledTimes(2);
            });

            it('入れた部屋があとで満員になれば、引き直したとき鍵を付ける', async () => {
                const c = clock();
                const fetchRoom = vi.fn(async () => users(3));
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now });
                expect(await lookup(goal)).not.toHaveProperty('locked');
                fetchRoom.mockResolvedValue(users(10));
                c.advance(ROOM_STATUS_TTL_MS);
                expect(await lookup(goal)).toMatchObject({ name: 'カフェ', locked: true });
            });

            it('引いている途中は、期限を過ぎても同じ問い合わせにまとめる（遅い通信で問い合わせを重ねない）', async () => {
                const c = clock();
                const answers: Array<(value: ReturnType<typeof room>) => void> = [];
                const fetchRoom = vi.fn(() => new Promise<ReturnType<typeof room>>((resolve) => answers.push(resolve)));
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now });
                const first = lookup(goal);
                c.advance(ROOM_STATUS_TTL_MS * 3);
                const second = lookup(goal);
                expect(second).toBe(first);
                expect(fetchRoom).toHaveBeenCalledTimes(1);
                answers[0]?.(users(10));
                expect(await first).toMatchObject({ locked: true });
                const third = lookup(goal);
                expect(fetchRoom).toHaveBeenCalledTimes(2);
                answers[1]?.(users(1));
                expect(await third).not.toHaveProperty('locked');
            });

            it('部屋ごとに別に引く（別の部屋の結果を使い回さない）', async () => {
                const fetchRoom = vi.fn(async (address: string) => users(address === 'full' ? 10 : 1));
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom));
                expect(await lookup({ kind: 'room', room: 'full' })).toMatchObject({ locked: true });
                expect(await lookup({ kind: 'room', room: 'open' })).not.toHaveProperty('locked');
            });

            it('一時的に引けなければ前の結果のまま。無くなった部屋（404）は null にする', async () => {
                const c = clock();
                const fetchRoom = vi.fn(async (): Promise<ReturnType<typeof users> | null> => users(2));
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now });
                const before = await lookup(goal);
                fetchRoom.mockRejectedValueOnce(new Error('502'));
                c.advance(ROOM_STATUS_TTL_MS);
                expect(await lookup(goal)).toBe(before);
                fetchRoom.mockResolvedValueOnce(null);
                c.advance(ROOM_STATUS_TTL_MS);
                expect(await lookup(goal)).toBeNull();
            });

            it('初めから引けなければ「確かめられない」（鍵も「無い部屋」も出さない）。期限を過ぎれば引き直す', async () => {
                const c = clock();
                const fetchRoom = vi.fn(async () => users(2));
                fetchRoom.mockRejectedValueOnce(new Error('503'));
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now });
                const first = await lookup(goal);
                expect(first).toBe(UNKNOWN_ROOM);
                expect(first).not.toHaveProperty('locked');
                c.advance(ROOM_STATUS_TTL_MS);
                expect(await lookup(goal)).toMatchObject({ name: 'カフェ' });
            });

            it('無くなった部屋のあとに一時的に引けなくても、「無い部屋」のまま（確かめられないに戻さない）', async () => {
                const c = clock();
                const fetchRoom = vi.fn(async (): Promise<ReturnType<typeof users> | null> => null);
                const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now });
                expect(await lookup(goal)).toBeNull();
                fetchRoom.mockRejectedValueOnce(new Error('503'));
                c.advance(ROOM_STATUS_TTL_MS);
                expect(await lookup(goal)).toBeNull();
            });

            it('応答の無い問い合わせは時間で諦め、その部屋の引き直しを止め続けない', async () => {
                vi.useFakeTimers();
                try {
                    const c = clock();
                    const fetchRoom = vi.fn(
                        (): Promise<ReturnType<typeof users> | null> => new Promise(() => undefined),
                    );
                    const lookup = createPortalLookup(vi.fn(), source(fetchRoom), { now: c.now, timeoutMs: 1000 });
                    const hung = lookup(goal);
                    await vi.advanceTimersByTimeAsync(1000);
                    expect(await hung).toBe(UNKNOWN_ROOM);
                    fetchRoom.mockResolvedValueOnce(users(1));
                    c.advance(ROOM_STATUS_TTL_MS);
                    expect(await lookup(goal)).toMatchObject({ name: 'カフェ' });
                    expect(fetchRoom).toHaveBeenCalledTimes(2);
                } finally {
                    vi.useRealTimers();
                }
            });
        });

        it('部屋を引く手段が無ければ（エディタ）、部屋は引かずに null', async () => {
            const fetchWorld = vi.fn();
            expect(await createPortalLookup(fetchWorld)({ kind: 'room', room: 'abc' })).toBeNull();
            expect(fetchWorld).not.toHaveBeenCalled();
        });
    });
});
