// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ridingSyncRef } from '../ridingSyncRef';
import { RideProvider, useRide } from './RideContext';

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
