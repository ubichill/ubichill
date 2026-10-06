// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SocketProvider, useSocket } from '../../../react/src/hooks/useSocket';
import type { InstanceGrant, ResolveInstance } from '../../../react/src/lib/instanceSocket';
import { useInstanceLoading } from './useInstanceLoading';

class WebSocketStub {
    static OPEN = 1;
    static instances: WebSocketStub[] = [];
    readyState = 0;
    bufferedAmount = 0;
    frames: Array<{ id: string }> = [];
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
function setup(resolveInstance: ResolveInstance) {
    function Wrapper({ children }: { children: ReactNode }) {
        return createElement(SocketProvider, { resolveInstance, children });
    }
    return renderHook(
        () => {
            const socket = useSocket();
            const loading = useInstanceLoading({
                instanceId: 'room',
                isAuthPending: false,
                isConnected: socket.isConnected,
                isConnecting: socket.isConnecting,
                isJoined: socket.currentUser !== null,
                error: socket.error,
                mods: { completed: 0, total: 0 },
                workers: { ready: 0, total: 0 },
            });
            return { socket, loading };
        },
        { wrapper: Wrapper },
    );
}

describe('接続処理と入室画面の失敗判定', () => {
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

    it('一度の503から入室できたら、失敗画面を固定せず復帰する', async () => {
        const resolve = vi.fn<ResolveInstance>().mockRejectedValueOnce(new Error('503')).mockResolvedValue(grant);
        const { result } = setup(resolve);
        await act(async () => result.current.socket.joinWorld('Alice', 'room'));
        expect(result.current.socket.isConnecting).toBe(true);
        expect(result.current.socket.error).toBeNull();
        expect(result.current.loading.failed).toBe(false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        await act(async () => WebSocketStub.instances.at(-1)?.join());
        await act(async () => {
            await vi.advanceTimersByTimeAsync(40000);
        });
        expect(result.current.socket.isConnected).toBe(true);
        expect(result.current.socket.isConnecting).toBe(false);
        expect(result.current.loading.failed).toBe(false);
        expect(resolve).toHaveBeenCalledTimes(2);
    });

    it('通信障害が続いたら上限で失敗を確定し、試行を繰り返さない', async () => {
        const resolve = vi.fn<ResolveInstance>().mockRejectedValue(new Error('503'));
        const { result } = setup(resolve);
        await act(async () => result.current.socket.joinWorld('Alice', 'room'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30000);
        });
        expect(result.current.socket.isConnecting).toBe(false);
        expect(result.current.socket.currentUser).toBeNull();
        expect(result.current.socket.error).toContain('上限');
        expect(result.current.loading.failed).toBe(true);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(120000);
        });
        expect(resolve).toHaveBeenCalledTimes(6);
    });

    it('画面の25秒タイマーが接続処理の30秒期限より先に失敗を確定しない', async () => {
        const resolve = vi.fn<ResolveInstance>(() => new Promise(() => {}));
        const { result } = setup(resolve);
        await act(async () => result.current.socket.joinWorld('Alice', 'room'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(25001);
        });
        expect(result.current.loading.failed).toBe(false);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4999);
        });
        expect(result.current.socket.isConnecting).toBe(false);
        expect(result.current.loading.failed).toBe(true);
        expect(result.current.loading.failureMessage).toContain('タイムアウト');
    });
});
