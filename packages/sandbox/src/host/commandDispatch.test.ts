import { CommandType, type ModGuestCommand } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import {
    type CommandContext,
    createCommandBudget,
    dispatchCommand,
    exceedsApproxSize,
    MAX_COMMANDS_PER_TICK,
    MAX_EMIT_DATA_BYTES,
    RpcTimeoutError,
    withRpcTimeout,
} from './commandDispatch';
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
        expect(onEventEmit).toHaveBeenCalledWith('x', 1, { scope: 'world' }, undefined, 'sender-1');
    });

    it('EVENT_EMIT の ref は scope より優先し、配送先の読めない emit は捨てる', async () => {
        const onEventEmit = vi.fn();
        const emit = (payload: unknown) =>
            dispatchCommand({ type: CommandType.EVENT_EMIT, payload } as ModGuestCommand, makeCtx({ onEventEmit }));
        await emit({ type: 'a', data: 1, ref: 'screen', scope: 'world' });
        await emit({ type: 'b', data: 2 });
        await emit({ type: 'c', data: 3, ref: 42 });
        await emit({ type: 'd', data: 4, scope: '' });
        expect(onEventEmit.mock.calls).toEqual([['a', 1, { ref: 'screen' }, undefined, 'sender-1']]);
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

describe('withRpcTimeout', () => {
    it('解決した RPC の timer は残さない（秒に数千回送る mod でも timer が溜まらない）', async () => {
        vi.useFakeTimers();
        try {
            await Promise.all(Array.from({ length: 5000 }, (_, i) => withRpcTimeout(Promise.resolve(i), 10_000, 'X')));
            await withRpcTimeout(Promise.reject(new Error('boom')), 10_000, 'X').catch(() => {});
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('時間内に終わらなければ RpcTimeoutError で失敗する', async () => {
        vi.useFakeTimers();
        try {
            const pending = withRpcTimeout(new Promise<never>(() => {}), 10_000, 'SCENE_UPDATE_ENTITY');
            const assertion = expect(pending).rejects.toBeInstanceOf(RpcTimeoutError);
            await vi.advanceTimersByTimeAsync(10_000);
            await assertion;
            await expect(pending).rejects.toThrow('SCENE_UPDATE_ENTITY');
        } finally {
            vi.useRealTimers();
        }
    });

    it('元の失敗はそのまま返す', async () => {
        const error = new Error('handler');
        await expect(withRpcTimeout(Promise.reject(error), 10_000, 'X')).rejects.toBe(error);
    });
});

describe('createCommandBudget（1 tick に受け付けるコマンドの数）', () => {
    const takeMany = (budget: ReturnType<typeof createCommandBudget>, count: number) =>
        Array.from({ length: count }, () => budget.take());

    it('上限までは受け付け、超えた最初の 1 件だけ drop-first にする（診断を 1 回にするため）', () => {
        const budget = createCommandBudget(3);
        expect(takeMany(budget, 6)).toEqual(['accept', 'accept', 'accept', 'drop-first', 'drop', 'drop']);
    });

    it('tick で数え直す', () => {
        const budget = createCommandBudget(2);
        takeMany(budget, 5);
        budget.reset();
        expect(takeMany(budget, 3)).toEqual(['accept', 'accept', 'drop-first']);
    });

    it('上限 0 は何も受け付けない・Infinity は数えない', () => {
        expect(takeMany(createCommandBudget(0), 2)).toEqual(['drop-first', 'drop']);
        expect(takeMany(createCommandBudget(Number.POSITIVE_INFINITY), 10_000).every((r) => r === 'accept')).toBe(true);
    });

    it('正規の mod の 1 tick 分（danmaku の自機・弾・壁と、起動時にまとめて作る Entity）は上限に届かない', () => {
        // danmaku: 自機の移動（SCENE_UPDATE_ENTITY）・発射（EVENT_EMIT）・弾の描画（CANVAS_FRAME）・UI_RENDER・ログ
        const danmakuTick = 5;
        // 起動時の取得とまとめての生成（SCENE_GET_ENTITY・SCENE_QUERY_ENTITIES・SCENE_CREATE_ENTITY × 200）
        const startupBurst = 2 + 200;
        expect(danmakuTick + startupBurst).toBeLessThan(MAX_COMMANDS_PER_TICK);
    });
});

describe('exceedsApproxSize（EVENT_EMIT の data のおおよその大きさ）', () => {
    it('小さな値は超えない', () => {
        expect(exceedsApproxSize({ x: 1, y: 2, speed: 320 }, MAX_EMIT_DATA_BYTES)).toBe(false);
        expect(exceedsApproxSize(undefined, MAX_EMIT_DATA_BYTES)).toBe(false);
        expect(exceedsApproxSize('x'.repeat(1024), 1024)).toBe(false);
    });

    it.each([
        ['長い文字列', 'x'.repeat(1025)],
        ['バイト列', new Uint8Array(1025)],
        ['ArrayBuffer', new ArrayBuffer(1025)],
        ['配列の要素の合計', Array.from({ length: 200 }, () => 'abcdef')],
        ['深い入れ子', Array.from({ length: 2000 }).reduce<unknown>((inner) => ({ a: inner }), 'x')],
        ['Map', new Map(Array.from({ length: 200 }, (_, i) => [`key-${i}`, i]))],
        ['Set', new Set(Array.from({ length: 200 }, (_, i) => `value-${i}`))],
    ])('%s は上限を超える', (_, value) => {
        expect(exceedsApproxSize(value, 1024)).toBe(true);
    });

    it('巨大な値でも上限を超えた時点で数えるのをやめる（全部は辿らない）', () => {
        const visited = { count: 0 };
        const huge = new Proxy(
            Array.from({ length: 1_000_000 }, () => 1),
            {
                get(target, key, receiver) {
                    if (typeof key === 'string' && /^\d+$/.test(key)) visited.count += 1;
                    return Reflect.get(target, key, receiver);
                },
            },
        );
        expect(exceedsApproxSize(huge, 1024)).toBe(true);
        expect(visited.count).toBeLessThan(10_000);
    });

    it('循環した値でも止まる', () => {
        const a: Record<string, unknown> = { name: 'a' };
        a.self = a;
        expect(exceedsApproxSize(a, 1024)).toBe(false);
    });
});
