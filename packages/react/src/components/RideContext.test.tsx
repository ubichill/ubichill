// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ridingSyncRef } from '../ridingSyncRef';
import { filterRideInput, RideProvider, useRide } from './RideContext';

const patchEntity = vi.fn();

vi.mock('../hooks/useWorld', () => ({
    useWorld: () => ({ patchEntity }),
}));

function setup() {
    const wrapper = ({ children }: { children: React.ReactNode }) => <RideProvider>{children}</RideProvider>;
    return renderHook(() => useRide(), { wrapper });
}

describe('RideContext / handleRideCommand', () => {
    beforeEach(() => {
        patchEntity.mockClear();
        ridingSyncRef.set(null);
    });

    it('mount で riding state を設定し、ridingSyncRef にも同期する', () => {
        const { result } = setup();
        act(() => result.current.handleRideCommand({ action: 'mount', entityId: 'vehicle-1' }));

        expect(result.current.riding).toEqual({ entityId: 'vehicle-1' });
        expect(ridingSyncRef.get()).toEqual({ entityId: 'vehicle-1' });
        expect(patchEntity).not.toHaveBeenCalled();
    });

    it('dismount で riding state を null に戻す', () => {
        const { result } = setup();
        act(() => result.current.handleRideCommand({ action: 'mount', entityId: 'vehicle-1' }));
        act(() => result.current.handleRideCommand({ action: 'dismount', entityId: 'vehicle-1' }));

        expect(result.current.riding).toBeNull();
        expect(ridingSyncRef.get()).toBeNull();
    });

    it('別の乗り物に乗っている状態で mount すると、前の乗り物の lockedBy を自動でクリアする', () => {
        const { result } = setup();
        act(() => result.current.handleRideCommand({ action: 'mount', entityId: 'vehicle-1' }));
        act(() => result.current.handleRideCommand({ action: 'mount', entityId: 'vehicle-2' }));

        expect(patchEntity).toHaveBeenCalledWith('vehicle-1', { lockedBy: null });
        expect(result.current.riding).toEqual({ entityId: 'vehicle-2' });
        expect(ridingSyncRef.get()).toEqual({ entityId: 'vehicle-2' });
    });

    it('乗っていない乗り物からの dismount は無視する', () => {
        const { result } = setup();
        act(() => result.current.handleRideCommand({ action: 'mount', entityId: 'vehicle-1' }));
        act(() => result.current.handleRideCommand({ action: 'dismount', entityId: 'vehicle-2' }));

        expect(result.current.riding).toEqual({ entityId: 'vehicle-1' });
    });
});

describe('filterRideInput', () => {
    const arrowDown = { type: 'KEY_DOWN', data: { key: 'ArrowLeft', code: 'ArrowLeft' } } as const;
    const arrowUp = { type: 'KEY_UP', data: { key: 'ArrowLeft', code: 'ArrowLeft' } } as const;
    const keyDown = { type: 'KEY_DOWN', data: { key: 'z', code: 'KeyZ' } } as const;

    it('乗車中の矢印キー押下は乗り物Workerだけに渡す', () => {
        const events = [arrowDown, arrowUp, keyDown];
        expect(filterRideInput(events, { entityId: 'vehicle-1' }, 'other')).toEqual([arrowUp, keyDown]);
        expect(filterRideInput(events, { entityId: 'vehicle-1' }, 'vehicle-1')).toEqual(events);
    });

    it('未乗車なら全入力をそのまま渡す', () => {
        const events = [arrowDown, arrowUp];
        expect(filterRideInput(events, null, 'other')).toBe(events);
    });
});
