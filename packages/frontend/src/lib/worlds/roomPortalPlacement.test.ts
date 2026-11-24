import { ROOM_PORTAL } from '@ubichill/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeRoomPortal, portalCooldownRemaining, type RoomPortalPlacementDeps } from './roomPortalPlacement';

const AT = { x: 120, y: 340 };
const live = () => new AbortController().signal;

function deps(overrides: Partial<RoomPortalPlacementDeps> = {}) {
    const calls: string[] = [];
    const value: RoomPortalPlacementDeps = {
        requestGrant: vi.fn(async (room: string) => {
            calls.push(`grant:${room}`);
            return `grant-for-${room}`;
        }),
        open: vi.fn(async (room: string, at: { x: number; y: number }, grant: string) => {
            calls.push(`open:${room}:${at.x},${at.y}:${grant}`);
            return null;
        }),
        ...overrides,
    };
    return { value, calls };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('placeRoomPortal', () => {
    it('行き先を決めてから許可をもらい、選んだ所に置く', async () => {
        const { value, calls } = deps();
        const room = vi.fn(async () => {
            calls.push('room');
            return 'new-room';
        });
        await expect(placeRoomPortal(value, room, AT, live())).resolves.toBeNull();
        expect(calls).toEqual(['room', 'grant:new-room', 'open:new-room:120,340:grant-for-new-room']);
    });

    it('部屋を作れなければ、許可も求めず置かない（作れない理由を返す）', async () => {
        const { value } = deps();
        const room = () => Promise.reject(new Error('インスタンスを作りすぎています'));
        await expect(placeRoomPortal(value, room, AT, live())).resolves.toBe('インスタンスを作りすぎています');
        expect(value.requestGrant).not.toHaveBeenCalled();
        expect(value.open).not.toHaveBeenCalled();
    });

    it('許可が出なければ置かない', async () => {
        const { value } = deps({ requestGrant: vi.fn(() => Promise.reject(new Error('この部屋には置けません'))) });
        await expect(placeRoomPortal(value, async () => 'r', AT, live())).resolves.toBe('この部屋には置けません');
        expect(value.open).not.toHaveBeenCalled();
    });

    it('インスタンスが断った理由をそのまま返す', async () => {
        const { value } = deps({ open: vi.fn(async () => '少し待ってから置き直してください') });
        await expect(placeRoomPortal(value, async () => 'r', AT, live())).resolves.toBe(
            '少し待ってから置き直してください',
        );
    });

    it('Error でない失敗・空の理由は決まった文にする', async () => {
        const { value } = deps();
        await expect(placeRoomPortal(value, () => Promise.reject('boom'), AT, live())).resolves.toBe(
            'ポータルを置けませんでした',
        );
        await expect(placeRoomPortal(value, () => Promise.reject(new Error('')), AT, live())).resolves.toBe(
            'ポータルを置けませんでした',
        );
    });

    it('部屋を作るのが返ってこなければ時間で切り、作る要求も取り消す', async () => {
        vi.useFakeTimers();
        const { value } = deps();
        const seen: AbortSignal[] = [];
        const room = (signal: AbortSignal) => {
            seen.push(signal);
            return new Promise<string>(() => undefined);
        };
        const result = placeRoomPortal(value, room, AT, live(), 1000);
        await vi.advanceTimersByTimeAsync(999);
        expect(seen[0]?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toBe('応答が無いため、ポータルを置けませんでした');
        expect(seen[0]?.aborted).toBe(true);
        expect(value.requestGrant).not.toHaveBeenCalled();
    });

    it('許可の要求も時間で切る', async () => {
        vi.useFakeTimers();
        const { value } = deps({ requestGrant: vi.fn(() => new Promise<string>(() => undefined)) });
        const result = placeRoomPortal(value, async () => 'r', AT, live(), 500);
        await vi.advanceTimersByTimeAsync(500);
        await expect(result).resolves.toBe('応答が無いため、ポータルを置けませんでした');
        expect(value.open).not.toHaveBeenCalled();
    });

    it('途中でやめたら、理由を出さず（null）置かない。要求も取り消す', async () => {
        const controller = new AbortController();
        const { value } = deps({
            requestGrant: vi.fn(
                (_room: string, signal: AbortSignal) =>
                    new Promise<string>((_resolve, reject) =>
                        signal.addEventListener('abort', () => reject(new Error('aborted by fetch'))),
                    ),
            ),
        });
        const result = placeRoomPortal(value, async () => 'r', AT, controller.signal);
        await Promise.resolve();
        await Promise.resolve();
        controller.abort();
        await expect(result).resolves.toBeNull();
        expect(value.open).not.toHaveBeenCalled();
    });

    it('許可が出た直後にやめても置かない', async () => {
        const controller = new AbortController();
        const { value } = deps({
            requestGrant: vi.fn(async () => {
                controller.abort();
                return 'grant';
            }),
        });
        await expect(placeRoomPortal(value, async () => 'r', AT, controller.signal)).resolves.toBeNull();
        expect(value.open).not.toHaveBeenCalled();
    });

    it('始める前にやめていれば、部屋も作らない', async () => {
        const controller = new AbortController();
        controller.abort();
        const room = vi.fn(async () => 'r');
        const { value } = deps();
        await expect(placeRoomPortal(value, room, AT, controller.signal)).resolves.toBeNull();
        expect(room).not.toHaveBeenCalled();
    });
});

describe('portalCooldownRemaining', () => {
    it('置いていなければ待たない', () => {
        expect(portalCooldownRemaining(null, 1_000)).toBe(0);
    });

    it('前に置いてから間隔の分だけ待つ（ちょうどで置ける）', () => {
        expect(portalCooldownRemaining(10_000, 10_000)).toBe(ROOM_PORTAL.COOLDOWN_MS);
        expect(portalCooldownRemaining(10_000, 10_000 + ROOM_PORTAL.COOLDOWN_MS - 1)).toBe(1);
        expect(portalCooldownRemaining(10_000, 10_000 + ROOM_PORTAL.COOLDOWN_MS)).toBe(0);
    });

    it('ずっと後でも負にしない。時計が戻っても間隔より長くは待たせない', () => {
        expect(portalCooldownRemaining(10_000, 50_000)).toBe(0);
        expect(portalCooldownRemaining(10_000, 9_000)).toBe(ROOM_PORTAL.COOLDOWN_MS);
    });
});
