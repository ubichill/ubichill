import { describe, expect, it, vi } from 'vitest';
import { placeRoomPortal, type RoomPortalPlacementDeps } from './roomPortalPlacement';

const AT = { x: 120, y: 340 };

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

describe('placeRoomPortal', () => {
    it('行き先を決めてから許可をもらい、選んだ所に置く', async () => {
        const { value, calls } = deps();
        const room = vi.fn(async () => {
            calls.push('room');
            return 'new-room';
        });
        await expect(placeRoomPortal(value, room, AT)).resolves.toBeNull();
        expect(calls).toEqual(['room', 'grant:new-room', 'open:new-room:120,340:grant-for-new-room']);
    });

    it('部屋を作れなければ、許可も求めず置かない（作れない理由を返す）', async () => {
        const { value } = deps();
        const room = () => Promise.reject(new Error('インスタンスを作りすぎています'));
        await expect(placeRoomPortal(value, room, AT)).resolves.toBe('インスタンスを作りすぎています');
        expect(value.requestGrant).not.toHaveBeenCalled();
        expect(value.open).not.toHaveBeenCalled();
    });

    it('許可が出なければ置かない', async () => {
        const { value } = deps({ requestGrant: vi.fn(() => Promise.reject(new Error('この部屋には置けません'))) });
        await expect(placeRoomPortal(value, async () => 'r', AT)).resolves.toBe('この部屋には置けません');
        expect(value.open).not.toHaveBeenCalled();
    });

    it('インスタンスが断った理由をそのまま返す', async () => {
        const { value } = deps({ open: vi.fn(async () => '少し待ってから置き直してください') });
        await expect(placeRoomPortal(value, async () => 'r', AT)).resolves.toBe('少し待ってから置き直してください');
    });

    it('Error でない失敗・空の理由は決まった文にする', async () => {
        const { value } = deps();
        await expect(placeRoomPortal(value, () => Promise.reject('boom'), AT)).resolves.toBe(
            'ポータルを置けませんでした',
        );
        await expect(placeRoomPortal(value, () => Promise.reject(new Error('')), AT)).resolves.toBe(
            'ポータルを置けませんでした',
        );
    });
});
