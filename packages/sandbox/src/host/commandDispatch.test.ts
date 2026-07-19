import { CommandType, type ModGuestCommand } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { type CommandContext, dispatchCommand, RpcTimeoutError } from './commandDispatch';
import type { HostHandlers } from './types';

function makeCtx(handlers: HostHandlers): CommandContext {
    return {
        handlers,
        withTimeout: (p) => p, // テストではタイムアウトなしで素通し
        senderComponentInstanceId: () => 'sender-1',
        logPrefix: '[test]',
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
