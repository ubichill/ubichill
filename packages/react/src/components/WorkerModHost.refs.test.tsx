// @vitest-environment jsdom
/**
 * 参照での配送を、WorkerModHost → useModWorker → ModHostManager → ModRegistry.routeEmit まで通して確かめる。
 * Worker だけを偽物にし、それ以外は本物を使う（WorkerModHost が配線を registry に渡さなくなると落ちる）。
 */
import { act, render } from '@testing-library/react';
import { resetRegistryForTests } from '@ubichill/sandbox';
import { CommandType, type ComponentInstance, HostEventType, PROTOCOL_VERSION } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerModDefinition } from '../types';
import { WorkerModHost } from './WorkerModHost';

vi.mock('../hooks/useSocket', () => ({
    useSocket: () => ({
        socket: null,
        isConnected: false,
        users: new Map(),
        currentUser: null,
        updatePosition: () => {},
    }),
}));
vi.mock('../hooks/useWorld', () => ({
    useWorld: () => ({
        entities: new Map(),
        ephemeralData: new Map(),
        patchEntity: () => {},
        createEntity: async () => null,
        deleteEntity: () => {},
    }),
}));

interface PostedEvent {
    type: string;
    payload?: { componentInstanceId?: string; eventType?: string; data?: unknown };
}

/** Worker の偽物。Host が送ったものを記録し、Worker からのコマンドを流し込める。 */
class FakeWorker {
    static all: FakeWorker[] = [];
    readonly posted: PostedEvent[] = [];
    private readonly listeners: Array<(e: MessageEvent) => void> = [];
    onerror: ((e: unknown) => void) | null = null;

    constructor() {
        FakeWorker.all.push(this);
    }
    addEventListener(type: string, listener: (e: MessageEvent) => void): void {
        if (type === 'message') this.listeners.push(listener);
    }
    removeEventListener(): void {}
    postMessage(message: PostedEvent): void {
        this.posted.push(message);
    }
    terminate(): void {}
    fromWorker(data: unknown): void {
        for (const listener of this.listeners) listener({ data } as MessageEvent);
    }
    get instanceId(): string | undefined {
        return this.posted.find((m) => m.type === HostEventType.EVT_LIFECYCLE_INIT)?.payload?.componentInstanceId;
    }
    customEvents(): Array<{ eventType?: string; data?: unknown }> {
        return this.posted.filter((m) => m.type === HostEventType.EVT_CUSTOM).map((m) => m.payload ?? {});
    }
}

const workerOf = (componentInstanceId: string): FakeWorker => {
    const found = FakeWorker.all.filter((w) => w.instanceId === componentInstanceId).at(-1);
    if (!found) throw new Error(`${componentInstanceId} の Worker がありません`);
    return found;
};

const instance = (entityId: string, type: string, data: Record<string, unknown> = {}): ComponentInstance => ({
    id: `${entityId}::0`,
    type,
    entityId,
    ownerId: null,
    lockedBy: null,
    transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
    data,
});

const remote: WorkerModDefinition = {
    id: 'test:remote',
    name: 'remote',
    workerCode: '/* remote */',
    capabilities: ['event:emit'],
    dataFields: { target: { type: 'entityRef', component: 'test:screen' } },
};
const screen: WorkerModDefinition = {
    id: 'test:screen',
    name: 'screen',
    workerCode: '/* screen */',
    capabilities: ['event:emit'],
};

function World({ target }: { target: string }) {
    return (
        <>
            <WorkerModHost
                entityId="remote::0"
                entity={instance('remote', 'test:remote', { target })}
                definition={remote}
            />
            <WorkerModHost entityId="tv::0" entity={instance('tv', 'test:screen')} definition={screen} />
            <WorkerModHost entityId="other::0" entity={instance('other', 'test:screen')} definition={screen} />
        </>
    );
}

function ready(): void {
    act(() => {
        for (const worker of FakeWorker.all) {
            worker.fromWorker({ type: CommandType.CMD_READY, payload: { protocolVersion: PROTOCOL_VERSION } });
        }
    });
}

function emitFrom(componentInstanceId: string, payload: Record<string, unknown>): void {
    act(() => {
        workerOf(componentInstanceId).fromWorker({ type: CommandType.EVENT_EMIT, payload });
    });
}

beforeEach(() => {
    FakeWorker.all = [];
    vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
    vi.unstubAllGlobals();
    resetRegistryForTests();
});

describe('WorkerModHost: 参照での配送（Host を通した結合）', () => {
    it('ref で送ると、作者が指した Entity の宣言した型にだけ届く', () => {
        const view = render(<World target="tv" />);
        ready();
        emitFrom('remote::0', { type: 'ping', data: 1, ref: 'target' });
        expect(workerOf('tv::0').customEvents()).toEqual([{ eventType: 'ping', data: 1 }]);
        expect(workerOf('other::0').customEvents()).toEqual([]);
        view.unmount();
    });

    it('作者が配線を変えると、Worker を作り直さずに次の emit から新しい相手に届く', () => {
        const view = render(<World target="tv" />);
        ready();
        const workers = FakeWorker.all.length;
        view.rerender(<World target="other" />);
        expect(FakeWorker.all.length).toBe(workers);
        emitFrom('remote::0', { type: 'ping', data: 2, ref: 'target' });
        expect(workerOf('other::0').customEvents()).toEqual([{ eventType: 'ping', data: 2 }]);
        expect(workerOf('tv::0').customEvents()).toEqual([]);
        view.unmount();
    });

    it("scope: 'referrers' は、参照で自分を指している Component にだけ返る", () => {
        const view = render(<World target="tv" />);
        ready();
        emitFrom('tv::0', { type: 'pong', data: 'state', scope: 'referrers' });
        emitFrom('other::0', { type: 'pong', data: 'stray', scope: 'referrers' });
        expect(workerOf('remote::0').customEvents()).toEqual([{ eventType: 'pong', data: 'state' }]);
        view.unmount();
    });

    it('宣言の無いフィールド名・配送先の無い emit は誰にも届かない', () => {
        const view = render(<World target="tv" />);
        ready();
        emitFrom('remote::0', { type: 'ping', data: 3, ref: 'nope' });
        emitFrom('remote::0', { type: 'ping', data: 4 });
        expect(workerOf('tv::0').customEvents()).toEqual([]);
        expect(workerOf('other::0').customEvents()).toEqual([]);
        view.unmount();
    });
});
