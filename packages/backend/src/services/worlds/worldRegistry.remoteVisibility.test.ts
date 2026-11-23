import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ほかの ubichill のサーバーが配るワールドの公開範囲（`Ubichill-World-Visibility`）を、このサーバーが守るか。
 * 取得（safeFetch）と DB を偽物にして、本物の worldRegistry と instanceManager を通す。
 */
const mocks = vi.hoisted(() => ({
    safeFetch: vi.fn<(url: string) => Promise<Response>>(),
    created: [] as Array<{ worldRef: string; leaderId: string }>,
    findByHandle: vi.fn(),
    findById: vi.fn(),
    findByAuthorAndWorldName: vi.fn(),
    findState: vi.fn(),
}));

vi.mock('../../lib/safeFetch', () => ({
    safeFetch: mocks.safeFetch,
    assertPublicUrl: vi.fn(),
}));
vi.mock('@ubichill/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@ubichill/db')>()),
    authorKeyRepository: {},
    federationPeerRepository: { findAll: vi.fn(async () => []) },
    userRepository: { findByHandle: mocks.findByHandle, findById: mocks.findById },
    worldRepository: {
        findByAuthorAndWorldName: mocks.findByAuthorAndWorldName,
        findByAuthorAndAlias: vi.fn(async () => undefined),
        findState: mocks.findState,
    },
    instanceRepository: {
        create: vi.fn(async (input: { worldRef: string; leaderId: string; maxUsers: number }) => {
            mocks.created.push({ worldRef: input.worldRef, leaderId: input.leaderId });
            return {
                ...input,
                id: `room-${mocks.created.length}`,
                accessTags: [],
                createdAt: new Date(0),
                expiresAt: null,
            };
        }),
        findById: vi.fn(async (id: string) => ({ id })),
    },
    inviteRepository: {},
}));
vi.mock('../../config', () => ({ appConfig: { runtime: { publicUrl: '/ws' } } }));
vi.mock('../instances/instanceRuntime', () => ({
    instanceRuntime: {
        provision: vi.fn(async () => ({ base: 'http://owner', gen: 1, epoch: 1 })),
        presence: vi.fn(async () => new Map()),
        roomPresence: vi.fn(async () => new Map()),
        close: vi.fn(async () => true),
    },
}));

import { WORLD_VISIBILITY_HEADER } from '@ubichill/shared';
import { instanceManager, PRIVATE_WORLD_MESSAGE } from '../instances/instanceManager';
import { worldRegistry } from './worldRegistry';

const SELF = 'https://ubichill.example';
const YAML = (name: string) => `
apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: ${name}
  version: 1.0.0
spec:
  displayName: ${name}
  capacity:
    default: 4
    max: 8
  initialEntities: []
`;

/** 作者のサーバー。YAML だけを配り、兄弟（lock・署名）は無い。 */
function serve(files: Record<string, { name: string; visibility?: string }>) {
    mocks.safeFetch.mockImplementation(async (url: string) => {
        const file = files[url];
        if (!file) return new Response('not found', { status: 404 });
        const headers: Record<string, string> = file.visibility ? { [WORLD_VISIBILITY_HEADER]: file.visibility } : {};
        return new Response(YAML(file.name), { status: 200, headers });
    });
}

const remoteUrl = (name: string) => `https://other.example/api/v1/authors/aya/worlds/${name}.yaml`;
const LOCAL_USERS = ['aya', 'bob', 'u-1'];

beforeEach(() => {
    vi.stubEnv('PUBLIC_BASE_URL', SELF);
    mocks.created.length = 0;
    mocks.safeFetch.mockReset();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('ほかのサーバーのワールドの公開範囲', () => {
    it('private と配られたワールドは、このサーバーのだれも部屋を作れない（403。作者の ID を持たせない）', async () => {
        const url = remoteUrl('secret');
        serve({ [url]: { name: 'secret', visibility: 'private' } });
        const resolution = await worldRegistry.resolveRefDetailed(url);
        expect(resolution.ok && resolution.world).toMatchObject({ visibility: 'private' });
        expect(resolution.ok && resolution.world.authorId).toBeUndefined();
        for (const user of LOCAL_USERS) {
            expect(await instanceManager.createInstance({ worldId: url }, user)).toEqual({
                error: PRIVATE_WORLD_MESSAGE,
                reason: 'forbidden',
            });
        }
        expect(mocks.created).toEqual([]);
    });

    it('public と配られた・ヘッダーの無い（古い版・ubichill でない）ワールドは、今までどおり作れる', async () => {
        const open = remoteUrl('open');
        const plain = 'https://pages.example/worlds/plain.yaml';
        serve({ [open]: { name: 'open', visibility: 'public' }, [plain]: { name: 'plain' } });
        expect(await instanceManager.createInstance({ worldId: open }, 'bob')).toMatchObject({ id: 'room-1' });
        expect(await instanceManager.createInstance({ worldId: plain }, 'bob')).toMatchObject({ id: 'room-2' });
        const resolution = await worldRegistry.resolveRefDetailed(plain);
        expect(resolution.ok && resolution.world.visibility).toBeUndefined();
    });

    it('知らない値はパブリックとして扱う', async () => {
        const url = remoteUrl('odd');
        serve({ [url]: { name: 'odd', visibility: 'unlisted' } });
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ id: 'room-1' });
    });

    it('作者がプライベートにしても、覚えている間は前の結果のまま。取り直したときから断る（期限の長さは remoteWorldCache のテスト）', async () => {
        const url = remoteUrl('later');
        serve({ [url]: { name: 'later', visibility: 'public' } });
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ id: 'room-1' });
        serve({ [url]: { name: 'later', visibility: 'private' } });
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ id: 'room-2' });
        await worldRegistry.resolveRemoteFresh(url);
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ reason: 'forbidden' });
    });

    it('このサーバー自身の URL は取得せず、DB のワールドとして解決する（作者は作れる、ほかの人は作れない）', async () => {
        serve({});
        const url = `${SELF}/api/v1/authors/aya/worlds/home.yaml`;
        mocks.findByHandle.mockResolvedValue({ id: 'aya-id', handle: 'aya' });
        mocks.findById.mockResolvedValue({ id: 'aya-id', handle: 'aya' });
        const record = {
            id: 'home-id',
            authorId: 'aya-id',
            worldName: 'home',
            visibility: 'public',
            currentVersionId: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
        };
        mocks.findByAuthorAndWorldName.mockResolvedValue(record);
        // 下書きだけ（公開する前）なのでプライベート
        mocks.findState.mockResolvedValue({
            world: record,
            draft: { worldId: 'home-id', definition: { ...(await import('yaml')).parse(YAML('home')) }, lock: null },
        });
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ reason: 'forbidden' });
        expect(await instanceManager.createInstance({ worldId: url }, 'aya-id')).toMatchObject({ id: 'room-1' });
        expect(mocks.safeFetch).not.toHaveBeenCalled();
    });
});

describe('ほかのサーバーの一覧', () => {
    it('ヘッダーで private と配られたワールドは publishableListItem に出さない', async () => {
        const url = remoteUrl('hidden');
        serve({ [url]: { name: 'hidden', visibility: 'private' } });
        expect(await worldRegistry.publishableListItem(url)).toBeUndefined();
    });
});
