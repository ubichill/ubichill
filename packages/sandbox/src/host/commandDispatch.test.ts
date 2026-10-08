import { CommandType, type ModGuestCommand } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { type CommandContext, dispatchCommand, RpcTimeoutError } from './commandDispatch';
import { createHostRequests } from './hostRequests';
import type { HostHandlers } from './types';

function makeCtx(handlers: HostHandlers, overrides: Partial<CommandContext> = {}): CommandContext {
    const requests = createHostRequests();
    return {
        handlers,
        withTimeout: (p) => p, // テストではタイムアウトなしで素通し
        senderComponentInstanceId: () => 'sender-1',
        logPrefix: '[test]',
        openRequest: (id, timeoutMs) => requests.open(id, timeoutMs),
        closeRequest: (id) => requests.close(id),
        abortRequest: (id) => requests.abort(id),
        loadAsset: async () => new ArrayBuffer(0),
        ...overrides,
    };
}

describe('dispatchCommand', () => {
    it('SCENE_GET_ENTITY を onGetEntity に振り分け、戻り値を返す', async () => {
        const entity = { id: 'e1' } as never;
        const onGetEntity = vi.fn(() => entity);
        const result = await dispatchCommand(
            { type: CommandType.SCENE_GET_ENTITY, payload: { id: 'e1' } } as ModGuestCommand,
            makeCtx({ onGetEntity }),
        );
        expect(onGetEntity).toHaveBeenCalledWith('e1');
        expect(result).toBe(entity);
    });

    it('SCENE_CREATE_ENTITY は onCreateEntity を呼び、生成 id を返す', async () => {
        const onCreateEntity = vi.fn(async () => ({ id: 'new-1' }) as never);
        const result = await dispatchCommand(
            { type: CommandType.SCENE_CREATE_ENTITY, payload: { entity: {} } } as ModGuestCommand,
            makeCtx({ onCreateEntity }),
        );
        expect(onCreateEntity).toHaveBeenCalled();
        expect(result).toBe('new-1');
    });

    it('EVENT_EMIT は senderComponentInstanceId を渡す', async () => {
        const onEventEmit = vi.fn();
        await dispatchCommand(
            {
                type: CommandType.EVENT_EMIT,
                payload: { type: 'x', data: 1, scope: 'world', targetType: undefined },
            } as ModGuestCommand,
            makeCtx({ onEventEmit }),
        );
        expect(onEventEmit).toHaveBeenCalledWith('x', 1, 'world', undefined, 'sender-1');
    });

    it('MEDIA_LOAD はドメイン確認を含む非同期ハンドラの完了を待つ', async () => {
        let release!: () => void;
        const pending = new Promise<void>((resolve) => {
            release = resolve;
        });
        const onMediaLoad = vi.fn(() => pending);
        let completed = false;
        const dispatched = dispatchCommand(
            {
                type: CommandType.MEDIA_LOAD,
                payload: { targetId: 'screen', url: 'https://media.example.com/video.mp4' },
            } as ModGuestCommand,
            makeCtx({ onMediaLoad }),
        ).then(() => {
            completed = true;
        });

        await Promise.resolve();
        expect(completed).toBe(false);
        release();
        await dispatched;
        expect(onMediaLoad).toHaveBeenCalledWith('screen', 'https://media.example.com/video.mp4', undefined, undefined);
    });

    it.each([
        [CommandType.CMD_GRIP, { action: 'release', entityId: 'victim', share: 'persistent' }, 'onGripCommand'],
        [CommandType.CMD_RIDE, { action: 'mount', entityId: 'victim' }, 'onRideCommand'],
    ] as const)('%s は Host が解決した sender id も handler に渡す', async (type, payload, handlerName) => {
        const handler = vi.fn();
        await dispatchCommand({ type, payload } as ModGuestCommand, makeCtx({ [handlerName]: handler }));
        expect(handler).toHaveBeenCalledWith(payload, 'sender-1');
    });

    it('CMD_LOG は onLog があればそちらへ、無ければ console にフォールバック', async () => {
        const onLog = vi.fn();
        await dispatchCommand(
            { type: CommandType.CMD_LOG, payload: { level: 'warn', message: 'hi' } } as ModGuestCommand,
            makeCtx({ onLog }),
        );
        expect(onLog).toHaveBeenCalledWith('warn', 'hi', '[test]');
    });

    it('未知コマンドは onCommand にフォールバックする', async () => {
        const onCommand = vi.fn();
        const cmd = { type: 'SOMETHING_NEW', payload: {} } as unknown as ModGuestCommand;
        await dispatchCommand(cmd, makeCtx({ onCommand }));
        expect(onCommand).toHaveBeenCalledWith(cmd);
    });

    it('RpcTimeoutError は instanceof で判別できる', () => {
        expect(new RpcTimeoutError('x')).toBeInstanceOf(RpcTimeoutError);
        expect(new RpcTimeoutError('x')).toBeInstanceOf(Error);
    });
});

describe('dispatchCommand: fetch・アセットの取り消しと制限時間', () => {
    const fetchCommand = (id: string, options?: Record<string, unknown>) =>
        ({
            type: CommandType.NETWORK_FETCH,
            id,
            payload: { url: 'https://api.example.com/x', options },
        }) as ModGuestCommand;

    it('NETWORK_FETCH は onFetch に abort できる signal を渡し、完了後は登録を外す', async () => {
        const requests = createHostRequests();
        const onFetch = vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', headers: {}, body: 'x' }));
        const ctx = makeCtx(
            { onFetch },
            {
                openRequest: (id, ms) => requests.open(id, ms),
                closeRequest: (id) => requests.close(id),
            },
        );

        await dispatchCommand(fetchCommand('rpc_1'), ctx);

        const context = (onFetch.mock.calls[0] as unknown[])[2] as { signal: AbortSignal };
        expect(context.signal).toBeInstanceOf(AbortSignal);
        expect(requests.size).toBe(0);
    });

    it('ハンドラが signal を無視して応答しなくても、CMD_ABORT で決着して FETCH_ABORTED を返す', async () => {
        const onFetch = vi.fn(() => new Promise<never>(() => {}));
        const ctx = makeCtx({ onFetch });

        const pending = dispatchCommand(fetchCommand('rpc_2', { responseType: 'arrayBuffer' }), ctx);
        await dispatchCommand({ type: CommandType.CMD_ABORT, payload: { requestId: 'rpc_2' } } as ModGuestCommand, ctx);

        const result = (await pending) as { ok: boolean; error?: { code: string }; body: unknown };
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('FETCH_ABORTED');
        expect(result.body).toBeInstanceOf(ArrayBuffer);
    });

    it('timeoutMs を過ぎたら FETCH_TIMEOUT を返す（承認待ちで止まったままにしない）', async () => {
        const onFetch = vi.fn(() => new Promise<never>(() => {}));
        const result = (await dispatchCommand(fetchCommand('rpc_3', { timeoutMs: 20 }), makeCtx({ onFetch }))) as {
            status: number;
            error?: { code: string };
        };
        expect(result.status).toBe(504);
        expect(result.error?.code).toBe('FETCH_TIMEOUT');
    });

    it('別のリクエスト id の CMD_ABORT は影響しない', async () => {
        const onFetch = vi.fn(async (_url: string, _opts?: unknown, context?: { signal?: AbortSignal }) => {
            await new Promise((r) => setTimeout(r, 10));
            return { ok: !context?.signal?.aborted, status: 200, statusText: 'OK', headers: {}, body: '' };
        });
        const ctx = makeCtx({ onFetch });
        const pending = dispatchCommand(fetchCommand('rpc_4'), ctx);
        await dispatchCommand({ type: CommandType.CMD_ABORT, payload: { requestId: 'other' } } as ModGuestCommand, ctx);
        expect(((await pending) as { ok: boolean }).ok).toBe(true);
    });

    it('ASSET_LOAD は loadAsset のバイト列を返し、取り消されたら FETCH_ABORTED で失敗する', async () => {
        const bytes = new Uint8Array([1, 2, 3]).buffer;
        const ok = await dispatchCommand(
            { type: CommandType.ASSET_LOAD, id: 'a1', payload: { path: 'x.wasm' } } as ModGuestCommand,
            makeCtx({}, { loadAsset: async (path) => (path === 'x.wasm' ? bytes : new ArrayBuffer(0)) }),
        );
        expect(ok).toBe(bytes);

        const ctx = makeCtx({}, { loadAsset: () => new Promise<never>(() => {}) });
        const pending = dispatchCommand(
            { type: CommandType.ASSET_LOAD, id: 'a2', payload: { path: 'big.bin' } } as ModGuestCommand,
            ctx,
        );
        await dispatchCommand({ type: CommandType.CMD_ABORT, payload: { requestId: 'a2' } } as ModGuestCommand, ctx);
        await expect(pending).rejects.toMatchObject({ code: 'FETCH_ABORTED' });
    });
});

describe('dispatchCommand: IDENTITY_TOKEN', () => {
    const command = (id: string) =>
        ({ type: CommandType.IDENTITY_TOKEN, id, payload: { audience: 'https://api.example.com' } }) as ModGuestCommand;

    it('onIdentityToken に宛先と取り消し用の signal を渡し、結果を返す', async () => {
        const onIdentityToken = vi.fn(async () => ({ token: 't', expiresAt: 1 }));
        const result = await dispatchCommand(command('i1'), makeCtx({ onIdentityToken }));
        expect(result).toEqual({ token: 't', expiresAt: 1 });
        expect(onIdentityToken).toHaveBeenCalledWith('https://api.example.com', { signal: expect.any(AbortSignal) });
    });

    it('ハンドラーが無い Host では IDENTITY_UNAVAILABLE で失敗する', async () => {
        await expect(dispatchCommand(command('i2'), makeCtx({}))).rejects.toMatchObject({
            code: 'IDENTITY_UNAVAILABLE',
        });
    });

    it('承認待ちで止まっていても CMD_ABORT で FETCH_ABORTED にする', async () => {
        const ctx = makeCtx({ onIdentityToken: () => new Promise<never>(() => {}) });
        const pending = dispatchCommand(command('i3'), ctx);
        await dispatchCommand({ type: CommandType.CMD_ABORT, payload: { requestId: 'i3' } } as ModGuestCommand, ctx);
        await expect(pending).rejects.toMatchObject({ code: 'FETCH_ABORTED' });
    });
});
