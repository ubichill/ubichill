import type { System } from '@ubichill/engine';
import { CommandType } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import type { OmitId } from '../types';
import { createEventModule, type EventModuleDeps } from './index';

type SentCommand = OmitId<Parameters<EventModuleDeps['send']>[0]>;

/** send と registerSystem を捕捉するテスト用 deps。 */
function makeDeps() {
    const sent: SentCommand[] = [];
    const systems: System[] = [];
    const deps: EventModuleDeps = {
        send: (cmd) => {
            sent.push(cmd);
        },
        registerSystem: (system) => {
            systems.push(system);
        },
    };
    // 登録済み System 群に擬似イベントを流し込むヘルパ。
    const dispatch = (events: Array<{ type: string; payload: unknown }>): void => {
        for (const sys of systems) sys({} as never, 0, events as never);
    };
    return { deps, sent, systems, dispatch };
}

describe('createEventModule', () => {
    it('emit は EVENT_EMIT を scope/targetType 付きで送る', () => {
        const { deps, sent } = makeDeps();
        const mod = createEventModule(deps);
        mod.emit('x', { a: 1 }, { scope: 'siblings', targetType: 'm:c' });
        expect(sent).toEqual([
            {
                type: CommandType.EVENT_EMIT,
                payload: { type: 'x', data: { a: 1 }, scope: 'siblings', targetType: 'm:c' },
            },
        ]);
    });

    it('broadcast / sendToHost はそれぞれ対応する CommandType を送る', () => {
        const { deps, sent } = makeDeps();
        const mod = createEventModule(deps);
        mod.broadcast('b', 1);
        mod.sendToHost('h', 2);
        expect(sent).toEqual([
            { type: CommandType.NETWORK_BROADCAST, payload: { type: 'b', data: 1 } },
            { type: CommandType.NETWORK_SEND_TO_HOST, payload: { type: 'h', data: 2 } },
        ]);
    });

    it('define: on() は初回だけ dispatcher System を 1 個登録する', () => {
        const { deps, systems } = makeDeps();
        const reg = createEventModule(deps).define<{ a: number; b: number }>();
        expect(systems).toHaveLength(0);
        reg.on('a', () => {});
        reg.on('b', () => {});
        expect(systems).toHaveLength(1); // 2 回目の on でも増えない
    });

    it('define: on() ハンドラは一致する type のイベントで payload を受け取る', () => {
        const { deps, dispatch } = makeDeps();
        const reg = createEventModule(deps).define<{ hit: { n: number } }>();
        const handler = vi.fn();
        reg.on('hit', handler);
        dispatch([
            { type: 'hit', payload: { n: 42 } },
            { type: 'other', payload: { n: 0 } },
        ]);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({ n: 42 });
    });

    it('define: on() の戻り値を呼ぶと unregister され以後呼ばれない', () => {
        const { deps, dispatch } = makeDeps();
        const reg = createEventModule(deps).define<{ hit: number }>();
        const handler = vi.fn();
        const off = reg.on('hit', handler);
        dispatch([{ type: 'hit', payload: 1 }]);
        off();
        dispatch([{ type: 'hit', payload: 2 }]);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(1);
    });

    it('define: onBroadcast は envelope を unwrap して (userId, data) で呼ぶ', () => {
        const { deps, dispatch } = makeDeps();
        const reg = createEventModule(deps).define<{ msg: string }>();
        const handler = vi.fn();
        reg.onBroadcast('msg', handler);
        dispatch([{ type: 'msg', payload: { userId: 'u1', data: 'hello' } }]);
        expect(handler).toHaveBeenCalledWith('u1', 'hello');
    });

    it('define: registry の emit/broadcast/sendToHost も生の send を呼ぶ', () => {
        const { deps, sent } = makeDeps();
        const reg = createEventModule(deps).define<{ e: number }>();
        reg.emit('e', 1, { scope: 'world' });
        reg.broadcast('e', 2);
        reg.sendToHost('e', 3);
        expect(sent.map((c) => c.type)).toEqual([
            CommandType.EVENT_EMIT,
            CommandType.NETWORK_BROADCAST,
            CommandType.NETWORK_SEND_TO_HOST,
        ]);
    });
});
