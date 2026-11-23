import type { CreateInstanceRequest, Instance } from '@ubichill/shared';
import { describe, expect, it, vi } from 'vitest';
import { PRIVATE_WORLD_PORTAL_MESSAGE, WORLD_PORTAL_HOLD_MS, worldPortalInstance } from './worldPortalEntry';

const URL = 'https://ubichill.example/api/v1/authors/aya/worlds/garden.yaml';

const room = (id: string, users: number, overrides: Partial<Instance> = {}): Instance => ({
    id,
    status: 'active',
    leaderId: 'leader',
    createdAt: '2026-11-22T00:00:00.000Z',
    expiresAt: null,
    world: { id: 'garden', version: '1', displayName: '庭', authorId: 'aya', mods: [] },
    access: { type: 'public', tags: [] },
    stats: { currentUsers: users, maxUsers: 10 },
    connection: { url: 'ws://x', namespace: '/' },
    ...overrides,
});

function deps(options: { visibility?: 'private' | 'public'; rooms?: Instance[] } = {}) {
    return {
        fetchWorld: vi.fn(async () => ({
            url: URL,
            ...(options.visibility ? { visibility: options.visibility } : {}),
        })),
        fetchInstances: vi.fn(async () => options.rooms ?? []),
        createInstance: vi.fn(async (request: CreateInstanceRequest) => room('created', 0, { id: request.worldId })),
    };
}

describe('worldPortalInstance', () => {
    it('入れるパブリックの部屋があれば、いちばん人のいる部屋に入り、作らない', async () => {
        const d = deps({ rooms: [room('quiet', 1), room('busy', 5)] });
        expect((await worldPortalInstance(d, '@aya/garden', 'me')).id).toBe('busy');
        expect(d.fetchInstances).toHaveBeenCalledWith(URL);
        expect(d.createInstance).not.toHaveBeenCalled();
    });

    it('入れる部屋が無ければ、正規の URL でパブリックの部屋を作り、入るまで空でも残すよう頼む', async () => {
        const d = deps({ rooms: [room('friends', 3, { access: { type: 'friend_only', tags: [] } })] });
        await worldPortalInstance(d, '@aya/garden', 'me');
        expect(d.createInstance).toHaveBeenCalledWith({
            worldId: URL,
            access: { type: 'public' },
            holdEmptyMs: WORLD_PORTAL_HOLD_MS,
        });
    });

    it('プライベートのワールドは、部屋を探しも作りもせずに断る', async () => {
        const d = deps({ visibility: 'private', rooms: [room('open', 2)] });
        await expect(worldPortalInstance(d, '@aya/garden', 'me')).rejects.toThrow(PRIVATE_WORLD_PORTAL_MESSAGE);
        expect(d.fetchInstances).not.toHaveBeenCalled();
        expect(d.createInstance).not.toHaveBeenCalled();
    });

    it('ワールドを引けなければ、そのまま失敗にする', async () => {
        const d = deps();
        d.fetchWorld.mockRejectedValueOnce(new Error('World not found'));
        await expect(worldPortalInstance(d, '@aya/gone', 'me')).rejects.toThrow('World not found');
        expect(d.createInstance).not.toHaveBeenCalled();
    });
});
