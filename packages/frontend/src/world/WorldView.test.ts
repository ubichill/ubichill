// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import type { Instance } from '@ubichill/shared';
import { createElement, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConfirmGate } from '../components/ui/confirmGate';

const h = vi.hoisted(() => ({
    joinWorld: vi.fn(),
    leaveWorld: vi.fn(async () => {}),
    resetWorld: vi.fn(),
    loadErrors: [] as Array<string | null>,
}));

vi.mock('@ubichill/react', () => ({
    useSocket: () => ({
        isConnected: true,
        isConnecting: false,
        error: null,
        sessionReplaced: false,
        currentUser: null,
        joinWorld: h.joinWorld,
        leaveWorld: h.leaveWorld,
    }),
    useWorld: () => ({ resetWorld: h.resetWorld, modLock: undefined }),
    WorkerLoadingProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock('../lib/console/consoleStore', () => ({ appConsole: { clear: () => {} }, logConsole: () => {} }));
vi.mock('./useUnknownCoreNotice', () => ({ useUnknownCoreNotice: () => {} }));
vi.mock('./useInstanceLoading', () => ({
    useInstanceLoading: ({ error }: { error: string | null }) => {
        h.loadErrors.push(error);
        return { showScreen: false, fadingOut: false, progress: 0, stages: [], failed: false, failureMessage: null };
    },
}));
vi.mock('./InstanceLoadingScreen', () => ({ InstanceLoadingScreen: () => null }));
vi.mock('./ModRegistryContext', () => ({ ModRegistryProvider: ({ children }: { children: unknown }) => children }));
vi.mock('./WorldStage', () => ({ WorldStage: () => null }));
vi.mock('./cursor/CursorLayer', () => ({ CursorLayer: () => null }));
vi.mock('./ServerNoticeToasts', () => ({ ServerNoticeToasts: () => null }));

const { ENTRY_DECLINED_MESSAGE, WorldView } = await import('./WorldView');

// 作者の署名が無いワールド（入る前に確かめる）
const unsignedInstance = { id: 'room-1', world: { id: 'cafe', displayName: 'カフェ' } } as unknown as Instance;

const enterUnderStrictMode = () => {
    const shown: Array<string | null> = [];
    const gate = createConfirmGate((message) => shown.push(message));
    render(
        createElement(
            StrictMode,
            null,
            createElement(WorldView, {
                instanceId: 'room-1',
                userName: 'alice',
                fetchInstance: async () => unsignedInstance,
                confirmEntry: gate.ask,
                modSource: { baseUrl: '/mods', allowUnsigned: false } as never,
                recovery: { label: 'ホームに戻る', run: () => {} },
            }),
        ),
    );
    return { gate, shown };
};

beforeEach(() => {
    sessionStorage.clear();
    h.joinWorld.mockClear();
    h.loadErrors.length = 0;
});
afterEach(cleanup);

describe('WorldView の入室（StrictMode で effect が 2 回走る開発時）', () => {
    it('作者を確認できないワールドの確認に「確認」と答えると、1 回だけ入室する', async () => {
        const { gate, shown } = enterUnderStrictMode();
        await vi.waitFor(() => expect(shown.at(-1)).toContain('「カフェ」は作者を確認できないワールドです'));

        await act(async () => gate.settle(true));
        await vi.waitFor(() => expect(h.joinWorld).toHaveBeenCalledTimes(1));
        expect(h.joinWorld).toHaveBeenCalledWith('alice', 'room-1', expect.any(Function));
        expect(h.loadErrors).not.toContain(ENTRY_DECLINED_MESSAGE);
    });

    it('「キャンセル」と答えると入室せず、取りやめたことを出す', async () => {
        const { gate, shown } = enterUnderStrictMode();
        await vi.waitFor(() => expect(shown.at(-1)).toContain('作者を確認できない'));

        await act(async () => gate.settle(false));
        await vi.waitFor(() => expect(h.loadErrors).toContain(ENTRY_DECLINED_MESSAGE));
        expect(h.joinWorld).not.toHaveBeenCalled();
    });
});
