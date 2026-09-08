import type { ResolvedWorld } from '@ubichill/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findInstanceForJoin: vi.fn(),
    reinitializeEntities: vi.fn(),
    verifyInstancePassword: vi.fn(),
    getWorldByUrl: vi.fn(),
    getInstanceSnapshot: vi.fn(),
    patchEntity: vi.fn(),
    getUserWorld: vi.fn(),
    removeUser: vi.fn(),
    addUser: vi.fn(),
    getUsersByWorld: vi.fn(),
}));

vi.mock('../config', () => ({ appConfig: { instance: { disconnectGracePeriodMs: 1_000 } } }));
vi.mock('../utils/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/instanceManager', () => ({
    instanceManager: {
        findInstanceForJoin: mocks.findInstanceForJoin,
        reinitializeEntities: mocks.reinitializeEntities,
        verifyInstancePassword: mocks.verifyInstancePassword,
    },
}));
vi.mock('../services/worldRegistry', () => ({
    worldRegistry: { getWorldByUrl: mocks.getWorldByUrl },
}));
vi.mock('../services/instanceState', () => ({
    getInstanceSnapshot: mocks.getInstanceSnapshot,
    patchEntity: mocks.patchEntity,
}));
vi.mock('../services/userManager', () => ({
    userManager: {
        getUserWorld: mocks.getUserWorld,
        removeUser: mocks.removeUser,
        addUser: mocks.addUser,
        getUsersByWorld: mocks.getUsersByWorld,
    },
}));

import { activeUserSockets, disconnectTimers, type TypedSocket } from './_shared';
import { handleWorldJoin } from './worldHandlers';

const EXTERNAL_REF = 'https://raw.githubusercontent.com/o/r/main/worlds/chillwa.yaml';
const WORLD = {
    url: EXTERNAL_REF,
    source: { kind: 'github', url: EXTERNAL_REF },
    id: 'chillwa',
    version: '1.0.0',
    displayName: 'ちるわ',
    environment: { backgroundColor: '#fff', worldSize: { width: 1600, height: 1000 } },
    capacity: { default: 10, max: 20 },
    dependencies: [{ name: 'video-player', source: { version: 'latest' } }],
    initialEntities: [],
    mods: [{ id: 'video-player', version: 'latest' }],
    lock: { lockVersion: 1, mods: {} },
} as ResolvedWorld;

function makeSocket(): TypedSocket {
    const broadcast = { emit: vi.fn() };
    return {
        id: 'socket-1',
        data: { authUser: { id: 'user-1', email: '', name: 'Alice', image: null } },
        emit: vi.fn(),
        join: vi.fn(),
        leave: vi.fn(),
        to: vi.fn(() => broadcast),
        nsp: { to: vi.fn(() => broadcast) },
        disconnect: vi.fn(),
        // biome-ignore lint/suspicious/noExplicitAny: Socket.IO の巨大な型に対する最小テストダブル
    } as any as TypedSocket;
}

describe('handleWorldJoin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        activeUserSockets.clear();
        for (const timer of disconnectTimers.values()) clearTimeout(timer);
        disconnectTimers.clear();
        mocks.findInstanceForJoin.mockResolvedValue({
            id: 'instance-1',
            hasPassword: false,
            worldRef: EXTERNAL_REF,
        });
        mocks.getWorldByUrl.mockResolvedValue(WORLD);
        mocks.getInstanceSnapshot.mockReturnValue([]);
        mocks.getUserWorld.mockReturnValue(undefined);
        mocks.getUsersByWorld.mockReturnValue([]);
    });

    it('旧worldIdを信用せずDBのworldRefから外部worldとlockを復元する', async () => {
        const socket = makeSocket();
        const callback = vi.fn();

        await handleWorldJoin(socket)(
            {
                instanceId: 'instance-1',
                worldId: 'forged-local-world',
                user: { name: 'Alice', status: 'online', position: { x: 0, y: 0 }, lastActiveAt: 0 },
            },
            callback,
        );

        expect(mocks.getWorldByUrl).toHaveBeenCalledWith(EXTERNAL_REF);
        expect(mocks.reinitializeEntities).toHaveBeenCalledWith('instance-1', WORLD);
        expect(socket.emit).toHaveBeenCalledWith(
            'world:snapshot',
            expect.objectContaining({ lock: WORLD.lock, sourceKind: 'github', environment: WORLD.environment }),
        );
        expect(callback).toHaveBeenCalledWith({ success: true, userId: 'user-1', instanceId: 'instance-1' });
    });
});
