// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceGrant, ResolveInstance } from '../lib/instanceSocket';
import { SocketProvider, useSocket } from './useSocket';

class WebSocketStub {
    static OPEN = 1;
    static instances: WebSocketStub[] = [];
    readyState = 0;
    bufferedAmount = 0;
    frames: Array<{ id?: string; event: string; data: unknown }> = [];
    onopen?: () => void;
    onclose?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor() {
        WebSocketStub.instances.push(this);
    }
    send(raw: string) {
        this.frames.push(JSON.parse(raw));
    }
    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.onclose?.();
    }
    join() {
        this.readyState = 1;
        this.onopen?.();
        this.onmessage?.({
            data: JSON.stringify({ replyTo: this.frames[0]?.id, data: { success: true, userId: 'alice' } }),
        });
    }
}

const grant: InstanceGrant = {
    url: 'https://runtime.test/realtime/v1/ws',
    token: 'ticket',
    userId: 'alice',
    expiresAt: 999999,
    protocolVersion: 1,
};

function setup() {
    const renders = { count: 0 };
    const resolve: ResolveInstance = async () => grant;
    function Wrapper({ children }: { children: ReactNode }) {
        return createElement(SocketProvider, { resolveInstance: resolve, children });
    }
    const hook = renderHook(
        () => {
            renders.count += 1;
            return useSocket();
        },
        { wrapper: Wrapper },
    );
    return { ...hook, renders };
}

async function joined() {
    const view = setup();
    await act(async () => view.result.current.joinWorld('Alice', 'room'));
    await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => WebSocketStub.instances.at(-1)?.join());
    return view;
}

const sent = (event: string) => (WebSocketStub.instances.at(-1)?.frames ?? []).filter((f) => f.event === event);

describe('自分のカーソル・状態の送信で、ソケットを使う画面を描き直さない', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        WebSocketStub.instances = [];
        vi.stubGlobal('WebSocket', WebSocketStub);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('カーソルを何度動かしても currentUser は同じまま描き直さず、位置は送る', async () => {
        const { result, renders } = await joined();
        const before = result.current.currentUser;
        expect(before?.id).toBe('alice');
        const rendersBefore = renders.count;
        act(() => {
            Array.from({ length: 50 }, (_, i) => result.current.updatePosition({ x: i, y: i * 2 }));
        });
        expect(result.current.currentUser).toBe(before);
        expect(renders.count).toBe(rendersBefore);
        expect(sent('cursor:move')).toHaveLength(50);
        expect(sent('cursor:move').at(-1)?.data).toEqual({ position: { x: 49, y: 98 } });
    });

    it('持っている Entity の id もそのまま送る（null は「離した」）', async () => {
        const { result } = await joined();
        act(() => {
            result.current.updatePosition({ x: 1, y: 1 }, 'pen-1');
            result.current.updatePosition({ x: 2, y: 2 }, null);
        });
        expect(sent('cursor:move').map((f) => f.data)).toEqual([
            { position: { x: 1, y: 1 }, heldEntityId: 'pen-1' },
            { position: { x: 2, y: 2 }, heldEntityId: null },
        ]);
    });

    it('状態を変えても currentUser は同じまま描き直さず、状態は送る', async () => {
        const { result, renders } = await joined();
        const before = result.current.currentUser;
        const rendersBefore = renders.count;
        act(() => result.current.updateStatus('busy'));
        expect(result.current.currentUser).toBe(before);
        expect(renders.count).toBe(rendersBefore);
        expect(sent('status:update').map((f) => f.data)).toEqual(['busy']);
    });

    it('入室する前は送らず、落ちない', () => {
        const { result } = setup();
        expect(() => {
            act(() => {
                result.current.updatePosition({ x: 1, y: 1 });
                result.current.updateStatus('away');
            });
        }).not.toThrow();
        expect(WebSocketStub.instances).toHaveLength(0);
    });
});
