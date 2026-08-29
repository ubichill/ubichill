// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { heldEntitySyncRef } from '../heldEntitySyncRef';
import { HoldProvider, useHold } from './HoldContext';

const patchEntity = vi.fn();
const entities = new Map<string, ComponentInstance>();

vi.mock('../hooks/useWorld', () => ({
    useWorld: () => ({ patchEntity, entities }),
}));

function makeEntity(id: string, x: number, y: number): ComponentInstance {
    return {
        id,
        type: 'pen:pen',
        ownerId: null,
        lockedBy: null,
        data: {},
        transform: { x, y, z: 0, w: 36, h: 48, scale: 1, rotation: 0 },
    };
}

function setup() {
    const wrapper = ({ children }: { children: React.ReactNode }) => <HoldProvider>{children}</HoldProvider>;
    return renderHook(() => useHold(), { wrapper });
}

const hold = (entityId: string) =>
    ({ action: 'hold', entityId, offsetX: -16, offsetY: -50, slot: 'pen', share: 'persistent' }) as const;
const release = (entityId: string, drop?: { x: number; y: number }) =>
    ({ action: 'release', entityId, share: 'persistent', dropX: drop?.x, dropY: drop?.y }) as const;

beforeEach(() => {
    patchEntity.mockClear();
    heldEntitySyncRef.set(null);
    entities.clear();
    entities.set('pen-a', makeEntity('pen-a', 25, 23));
    entities.set('pen-b', makeEntity('pen-b', 92, 22));
    const w = window as Window & { _lastMouseX?: number; _lastMouseY?: number };
    w._lastMouseX = undefined;
    w._lastMouseY = undefined;
});

describe('HoldContext / handleGripCommand', () => {
    it('hold で held state を設定し heldEntitySyncRef にも同期する', () => {
        const { result } = setup();
        act(() => result.current.handleGripCommand(hold('pen-a')));

        expect(result.current.held?.entityId).toBe('pen-a');
        expect(heldEntitySyncRef.get()?.entityId).toBe('pen-a');
    });

    it('dropX/dropY 付きの release はその座標へ Entity を移動する（トレイへ戻す）', () => {
        const { result } = setup();
        act(() => result.current.handleGripCommand(hold('pen-a')));
        act(() => result.current.handleGripCommand(release('pen-a', { x: 16, y: 16 })));

        expect(patchEntity).toHaveBeenCalledWith('pen-a', {
            transform: expect.objectContaining({ x: 16, y: 16 }),
        });
        expect(result.current.held).toBeNull();
    });

    it('dropX/dropY が無い release は最後のポインタ位置 + offset へ落とす', () => {
        const w = window as Window & { _lastMouseX?: number; _lastMouseY?: number };
        w._lastMouseX = 200;
        w._lastMouseY = 300;

        const { result } = setup();
        act(() => result.current.handleGripCommand(hold('pen-a')));
        act(() => result.current.handleGripCommand(release('pen-a')));

        expect(patchEntity).toHaveBeenCalledWith('pen-a', {
            transform: expect.objectContaining({ x: 200 - 16, y: 300 - 50 }),
        });
    });

    // 持ち替え: B の hold が先に届き、その後で A の release が届く。
    // ここで hold 状態を畳んでしまうと B の追従だけが止まり、worker 側は掴んだままなので
    // 「ペンが追従しないのに描ける」状態になる。
    describe('持ち替え（A を持ったまま B を掴む）', () => {
        it('後から届く A の release で B の hold を畳まない', () => {
            const { result } = setup();
            act(() => result.current.handleGripCommand(hold('pen-a')));
            act(() => result.current.handleGripCommand(hold('pen-b')));
            act(() => result.current.handleGripCommand(release('pen-a', { x: 16, y: 16 })));

            expect(result.current.held?.entityId).toBe('pen-b');
            expect(heldEntitySyncRef.get()?.entityId).toBe('pen-b');
        });

        it('持っていない Entity の release では移動も起こさない', () => {
            const { result } = setup();
            act(() => result.current.handleGripCommand(hold('pen-b')));
            act(() => result.current.handleGripCommand(release('pen-a', { x: 16, y: 16 })));

            expect(patchEntity).not.toHaveBeenCalled();
        });

        it('持っている B を release すれば通常どおり畳まれる', () => {
            const { result } = setup();
            act(() => result.current.handleGripCommand(hold('pen-b')));
            act(() => result.current.handleGripCommand(release('pen-b', { x: 16, y: 96 })));

            expect(result.current.held).toBeNull();
            expect(heldEntitySyncRef.get()).toBeNull();
            expect(patchEntity).toHaveBeenCalledWith('pen-b', {
                transform: expect.objectContaining({ x: 16, y: 96 }),
            });
        });
    });

    it('setHover は hold 前に届いても hold 時のカーソル設定として反映される', () => {
        const { result } = setup();
        act(() =>
            result.current.handleGripCommand({ action: 'setHover', cursor: 'grab', heldCursor: 'grabbing' } as const),
        );
        act(() => result.current.handleGripCommand(hold('pen-a')));

        expect(result.current.held).toMatchObject({ hoverCursor: 'grab', heldCursor: 'grabbing' });
    });
});
