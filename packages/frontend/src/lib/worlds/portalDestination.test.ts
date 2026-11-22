import { describe, expect, it, vi } from 'vitest';
import { createPortalLookup, type PortalRoomSource, portalWorldRef } from './portalDestination';

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
            expect(fetchRoom).toHaveBeenCalledWith('abc');
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
                source(async () => {
                    throw new Error('インスタンスが見つかりません');
                }),
            );
            expect(await lookup({ kind: 'room', room: 'abc' })).toBeNull();
            expect(await lookup({ kind: 'id', id: 'abc' })).toEqual({ name: 'abc という名前のワールド' });
        });

        it('部屋を引く手段が無ければ（エディタ）、部屋は引かずに null', async () => {
            const fetchWorld = vi.fn();
            expect(await createPortalLookup(fetchWorld)({ kind: 'room', room: 'abc' })).toBeNull();
            expect(fetchWorld).not.toHaveBeenCalled();
        });
    });
});
