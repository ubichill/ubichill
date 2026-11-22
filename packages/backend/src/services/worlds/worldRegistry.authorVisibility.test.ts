import { generateKeyPairSync, sign } from 'node:crypto';
import { signWorld, WORLD_VISIBILITY_HEADER, type WorldSignature } from '@ubichill/shared';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { nodeWorldCrypto } from './worldCrypto';

/**
 * プライベートのワールドのファイル（誰にでも配る）を別の場所に置き直しても、署名の作者の公開範囲に従うか。
 * 取得（safeFetch）・DB・作者の鍵の確認を偽物にして、本物の worldRegistry と instanceManager を通す。
 */
const mocks = vi.hoisted(() => ({
    files: new Map<string, { body: string; headers?: Record<string, string> } | 'down'>(),
    created: [] as string[],
    findByHandle: vi.fn(),
    findById: vi.fn(),
    findByAuthorAndWorldName: vi.fn(),
    findByAuthorAndAlias: vi.fn(),
    findState: vi.fn(),
}));

vi.mock('../../lib/safeFetch', () => ({
    safeFetch: vi.fn(async (url: string) => {
        const file = mocks.files.get(url);
        if (file === 'down') throw new Error('ECONNREFUSED');
        return file
            ? new Response(file.body, { status: 200, headers: file.headers })
            : new Response('', { status: 404 });
    }),
    assertPublicUrl: vi.fn(),
}));
vi.mock('../authors/authorKeyService', () => ({
    isAuthorKey: vi.fn(async () => ({ status: 'confirmed' })),
    resolveAuthorDisplayName: vi.fn(async () => undefined),
    invalidateAuthorKey: vi.fn(),
}));
vi.mock('@ubichill/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@ubichill/db')>()),
    authorKeyRepository: {},
    federationPeerRepository: { findAll: vi.fn(async () => []) },
    userRepository: { findByHandle: mocks.findByHandle, findById: mocks.findById },
    worldRepository: {
        findByAuthorAndWorldName: mocks.findByAuthorAndWorldName,
        findByAuthorAndAlias: mocks.findByAuthorAndAlias,
        findState: mocks.findState,
    },
    instanceRepository: {
        create: vi.fn(async (input: { worldRef: string; maxUsers: number }) => {
            mocks.created.push(input.worldRef);
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

import { instanceManager } from '../instances/instanceManager';
import { worldRegistry } from './worldRegistry';

const SELF = 'https://ubichill.example';
const AYA_ID = 'aya-user-id';
const LOCAL_USERS = ['bob', 'carol'];

const definitionOf = (name: string) => ({
    apiVersion: 'ubichill.com/v1alpha1',
    kind: 'World',
    metadata: { name, version: '1.0.0' },
    spec: {
        displayName: name,
        thumbnail: 'https://example.com/t.png',
        capacity: { default: 4, max: 8 },
        initialEntities: [],
    },
});

const key = (() => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
        publicKey: publicKey.export({ format: 'jwk' }).x as string,
        sign: async (message: string) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url'),
    };
})();

const signed = new Map<string, WorldSignature>();
async function signatureOf(author: string, name: string): Promise<WorldSignature> {
    const id = `${author}/${name}`;
    const known = signed.get(id);
    if (known) return known;
    const signature = await signWorld({ definition: definitionOf(name), lock: null }, key, nodeWorldCrypto, { author });
    signed.set(id, signature);
    return signature;
}

/** url（.yaml）と兄弟の .sig.json を配る。 */
async function host(url: string, author: string, name: string, headers?: Record<string, string>) {
    mocks.files.set(url, { body: yaml.stringify(definitionOf(name)), headers });
    mocks.files.set(url.replace(/\.yaml$/, '.sig.json'), { body: JSON.stringify(await signatureOf(author, name)) });
}

/** このサーバーの aya の DB のワールド（署名して公開した版つき）。 */
async function ayaWorld(name: string, visibility: 'private' | 'public', options: { renamedTo?: string } = {}) {
    const record = {
        id: `db-${name}`,
        authorId: AYA_ID,
        worldName: options.renamedTo ?? name,
        visibility,
        currentVersionId: 'v1',
        createdAt: new Date(0),
        updatedAt: new Date(0),
    };
    mocks.findByAuthorAndWorldName.mockImplementation(async (_user: string, n: string) =>
        n === record.worldName ? record : undefined,
    );
    mocks.findByAuthorAndAlias.mockImplementation(async (_user: string, n: string) =>
        options.renamedTo && n === name ? record : undefined,
    );
    const signature = await signatureOf('aya@ubichill.example', name);
    mocks.findState.mockResolvedValue({
        world: record,
        current: { id: 'v1', definition: definitionOf(name), lock: null, signature, version: '1.0.0' },
    });
}

beforeAll(() => {
    vi.stubEnv('PUBLIC_BASE_URL', SELF);
});

beforeEach(() => {
    mocks.files.clear();
    mocks.created.length = 0;
    worldRegistry.invalidateResolvedWorlds();
    mocks.findByHandle.mockImplementation(async (handle: string) =>
        handle === 'aya' ? { id: AYA_ID, handle } : undefined,
    );
    mocks.findById.mockImplementation(async (id: string) => (id === AYA_ID ? { id, handle: 'aya' } : undefined));
});

/** 毎回別の URL にする（外部のワールドの結果は 5 分覚えるので、テストどうしで混ざらない）。 */
const mirror = (label: string) => `https://mirror.example/${label}-${Math.random().toString(36).slice(2)}.yaml`;

describe('作者がこのサーバーのアカウントのワールドの写し', () => {
    it('プライベートのワールドの写しは、作者でなければ部屋を作れず（403）、一覧にも出ない。作者は作れる', async () => {
        await ayaWorld('secret', 'private');
        const url = mirror('secret');
        await host(url, 'aya@ubichill.example', 'secret');
        for (const user of LOCAL_USERS) {
            expect(await instanceManager.createInstance({ worldId: url }, user)).toMatchObject({ reason: 'forbidden' });
        }
        expect(await worldRegistry.publishableListItem(url)).toBeUndefined();
        expect(await instanceManager.createInstance({ worldId: url }, AYA_ID)).toMatchObject({ id: 'room-1' });
    });

    it('パブリックのワールドの写しは、今までどおりだれでも作れる', async () => {
        await ayaWorld('open', 'public');
        const url = mirror('open');
        await host(url, 'aya@ubichill.example', 'open');
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ id: 'room-1' });
    });

    it('名前を変えたワールドも、以前の名前の署名の写しをたどる', async () => {
        await ayaWorld('old-name', 'private', { renamedTo: 'new-name' });
        const url = mirror('renamed');
        await host(url, 'aya@ubichill.example', 'old-name');
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ reason: 'forbidden' });
    });
});

describe('作者がほかのサーバーのアカウントのワールドの写し', () => {
    const canonical = (name: string) => `https://author.example/api/v1/authors/aya/worlds/${name}.yaml`;

    it('作者のサーバーの正規の URL が private を返せば、このサーバーのだれも作れない', async () => {
        await host(canonical('hidden'), 'aya@author.example', 'hidden', { [WORLD_VISIBILITY_HEADER]: 'private' });
        const url = mirror('hidden');
        await host(url, 'aya@author.example', 'hidden');
        for (const user of LOCAL_USERS) {
            expect(await instanceManager.createInstance({ worldId: url }, user)).toMatchObject({ reason: 'forbidden' });
        }
        expect(await worldRegistry.publishableListItem(url)).toBeUndefined();
    });

    it('正規の URL が public・ヘッダー無しなら作れる', async () => {
        await host(canonical('shared'), 'aya@author.example', 'shared', { [WORLD_VISIBILITY_HEADER]: 'public' });
        await host(canonical('plain'), 'aya@author.example', 'plain');
        for (const name of ['shared', 'plain']) {
            const url = mirror(name);
            await host(url, 'aya@author.example', name);
            expect(await instanceManager.createInstance({ worldId: url }, 'bob')).not.toHaveProperty('reason');
        }
    });

    it('正規の URL が無い（消した・名前を変えた）・つながらないときはパブリック（閉じない。判断は design に書いた）', async () => {
        mocks.files.set(canonical('down'), 'down');
        for (const name of ['gone', 'down']) {
            const url = mirror(name);
            await host(url, 'aya@author.example', name);
            expect(await instanceManager.createInstance({ worldId: url }, 'bob')).not.toHaveProperty('reason');
        }
    });

    it('正規の URL そのものなら、そのヘッダーだけで決める（もう一度取りに行かない）', async () => {
        await host(canonical('direct'), 'aya@author.example', 'direct', { [WORLD_VISIBILITY_HEADER]: 'private' });
        const { safeFetch } = await import('../../lib/safeFetch');
        vi.mocked(safeFetch).mockClear();
        expect(await instanceManager.createInstance({ worldId: canonical('direct') }, 'bob')).toMatchObject({
            reason: 'forbidden',
        });
        // YAML・lock・署名の 3 つだけ
        expect(vi.mocked(safeFetch).mock.calls.map(([u]) => u)).toHaveLength(3);
    });
});
