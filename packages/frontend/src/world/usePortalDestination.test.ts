// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PortalDestination, type PortalLookup, PortalLookupProvider } from './portalNavigation';
import { needsRefresh, ROOM_PORTAL_REFRESH_MS, usePortalDestination } from './usePortalDestination';

const OPEN: PortalDestination = { name: 'カフェ' };
const LOCKED: PortalDestination = { name: 'カフェ', locked: true };

function render(lookup: PortalLookup) {
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(PortalLookupProvider, { value: lookup }, children);
    return renderHook(() => usePortalDestination({ kind: 'room', room: 'abc' }), { wrapper });
}

const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    setHidden(false);
});

describe('needsRefresh', () => {
    it('鍵・無い部屋・確かめられない部屋だけを引き直す', () => {
        expect(needsRefresh(LOCKED)).toBe(true);
        expect(needsRefresh(null)).toBe(true);
        expect(needsRefresh({ unknown: true })).toBe(true);
        expect(needsRefresh(OPEN)).toBe(false);
        expect(needsRefresh(undefined)).toBe(false);
    });
});

describe('usePortalDestination', () => {
    it('入れると分かった部屋は、出している間も引き直さない（移る直前に確かめる）', async () => {
        const lookup = vi.fn<PortalLookup>(async () => OPEN);
        const { result } = render(lookup);
        await act(async () => undefined);
        expect(result.current).toBe(OPEN);
        await act(async () => vi.advanceTimersByTimeAsync(ROOM_PORTAL_REFRESH_MS * 5));
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it('鍵の付いた部屋は引き直し、空きができたら鍵を外して引き直しをやめる', async () => {
        const lookup = vi.fn<PortalLookup>(async () => LOCKED);
        const { result } = render(lookup);
        await act(async () => undefined);
        expect(result.current).toBe(LOCKED);
        lookup.mockResolvedValue(OPEN);
        await act(async () => vi.advanceTimersByTimeAsync(ROOM_PORTAL_REFRESH_MS));
        expect(result.current).toBe(OPEN);
        const calls = lookup.mock.calls.length;
        await act(async () => vi.advanceTimersByTimeAsync(ROOM_PORTAL_REFRESH_MS * 3));
        // 鍵が外れて効果を張り直したときの 1 回（lookup の期限の内なので問い合わせにはならない）まで
        expect(lookup.mock.calls.length).toBeLessThanOrEqual(calls + 1);
    });

    it('見えないタブでは引かず、見えるようになったらすぐ引き直す', async () => {
        const lookup = vi.fn<PortalLookup>(async () => LOCKED);
        render(lookup);
        await act(async () => undefined);
        // 鍵が付いて引き直しを始めたときの分まで数えておく（lookup の期限の内なので問い合わせにはならない）
        const settled = lookup.mock.calls.length;
        act(() => setHidden(true));
        await act(async () => vi.advanceTimersByTimeAsync(ROOM_PORTAL_REFRESH_MS * 3));
        expect(lookup).toHaveBeenCalledTimes(settled);
        await act(async () => setHidden(false));
        expect(lookup).toHaveBeenCalledTimes(settled + 1);
    });
});
