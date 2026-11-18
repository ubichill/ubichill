import { CommandType, HostEventType, UbiErrorCode } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_EMIT_DATA_BYTES } from './commandDispatch';
import { ModHostManager } from './ModHostManager';
import { resetRegistryForTests } from './ModRegistry';
import {
    type ModDiagnostic,
    resetDiagnosticHandler,
    resetDiagnosticThrottleForTests,
    setDiagnosticHandler,
} from './modDiagnostics';
import type { HostHandlers, ModHostManagerOptions } from './types';

/** Worker の代わり。Host が送ったものを記録し、Worker からのメッセージを流し込める。 */
class FakeWorker {
    static last: FakeWorker | undefined;
    readonly posted: unknown[] = [];
    readonly listeners: Array<(event: MessageEvent) => void> = [];
    onerror: ((event: ErrorEvent) => void) | null = null;
    constructor() {
        FakeWorker.last = this;
    }
    addEventListener(type: string, listener: (event: MessageEvent) => void): void {
        if (type === 'message') this.listeners.push(listener);
    }
    postMessage(message: unknown): void {
        this.posted.push(message);
    }
    terminate(): void {}
    send(data: unknown): void {
        for (const listener of this.listeners) listener({ data } as MessageEvent);
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const managers: ModHostManager[] = [];

function start(options: Partial<ModHostManagerOptions> & { handlers?: HostHandlers } = {}) {
    const manager = new ModHostManager({
        modCode: '',
        modId: 'evil:main',
        disableAutoTick: true,
        handlers: {},
        ...options,
    });
    managers.push(manager);
    const worker = FakeWorker.last;
    if (!worker) throw new Error('Worker を作っていない');
    worker.send({ type: CommandType.CMD_READY, payload: { protocolVersion: 0 } });
    return worker;
}

const rpcResponses = (worker: FakeWorker) =>
    worker.posted.filter((m): m is { type: string; id: string; success: boolean; errorCode?: string; error?: string } =>
        Boolean(m && typeof m === 'object' && (m as { type?: string }).type === HostEventType.EVT_RPC_RESPONSE),
    );

describe('ModHostManager: 許されていないコマンドの拒否', () => {
    const diagnostics: ModDiagnostic[] = [];

    beforeEach(() => {
        vi.stubGlobal('Worker', FakeWorker);
        setDiagnosticHandler((d) => diagnostics.push(d));
    });

    afterEach(() => {
        for (const manager of managers.splice(0)) manager.destroy();
        diagnostics.splice(0);
        resetDiagnosticHandler();
        resetDiagnosticThrottleForTests();
        resetRegistryForTests();
        vi.unstubAllGlobals();
    });

    it('未宣言のコマンドは RPC を失敗で返し、診断に capability を載せる（mod が決めた type は載せない）', async () => {
        const worker = start({ capabilities: [] });
        worker.send({ type: CommandType.NETWORK_FETCH, id: 'r1', payload: { url: 'https://x.example/' } });
        await flush();
        expect(rpcResponses(worker)).toEqual([
            expect.objectContaining({ id: 'r1', success: false, errorCode: UbiErrorCode.CAPABILITY_NOT_DECLARED }),
        ]);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatchObject({ modId: 'evil:main', code: UbiErrorCode.CAPABILITY_NOT_DECLARED });
        expect(diagnostics[0]?.message).not.toContain('NETWORK_FETCH');
    });

    it('on-demand で拒否したら、許可に変えられるよう retry に capability を載せる', async () => {
        const worker = start({ authorizeCapability: () => false, capabilities: ['net:fetch'] });
        worker.send({ type: CommandType.NETWORK_FETCH, id: 'r1', payload: { url: 'https://x.example/' } });
        await flush();
        expect(diagnostics).toEqual([
            expect.objectContaining({
                code: UbiErrorCode.CAPABILITY_DENIED,
                retry: { subject: expect.any(String), capability: 'net:fetch' },
            }),
        ]);
    });

    it('type を毎回変えても、診断は 1 回に抑える（トーストを溢れさせない）', async () => {
        const worker = start({ authorizeCapability: () => false });
        for (const i of Array.from({ length: 200 }, (_, n) => n)) {
            worker.send({ type: `BOGUS_${i}_${'x'.repeat(i)}`, id: `r${i}`, payload: {} });
        }
        await flush();
        expect(rpcResponses(worker)).toHaveLength(200);
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]?.message).not.toMatch(/BOGUS/);
        expect(diagnostics[0]).not.toHaveProperty('retry');
    });

    it('EVENT_EMIT の data が上限を超えたら配送せず、1 回だけ診断を出す', async () => {
        const onEventEmit = vi.fn();
        const worker = start({ capabilities: ['event:emit'], handlers: { onEventEmit } });
        const emit = (data: unknown) =>
            worker.send({ type: CommandType.EVENT_EMIT, payload: { type: 't', data, scope: 'world' } });
        emit({ x: 1, y: 2, speed: 320 });
        emit({ blob: 'x'.repeat(MAX_EMIT_DATA_BYTES + 1) });
        emit({ bytes: new Uint8Array(MAX_EMIT_DATA_BYTES + 1) });
        await flush();
        expect(onEventEmit).toHaveBeenCalledTimes(1);
        expect(onEventEmit).toHaveBeenCalledWith(
            't',
            { x: 1, y: 2, speed: 320 },
            { scope: 'world' },
            undefined,
            undefined,
        );
        expect(diagnostics).toEqual([expect.objectContaining({ code: UbiErrorCode.RESOURCE_LIMIT_EXCEEDED })]);
    });
});
