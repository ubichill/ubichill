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
    files: new Map<string, { body: string; headers?: Record<string, string>; status?: number } | 'down'>(),
    created: [] as string[],
    findByHandle: vi.fn(),
    findById: vi.fn(),
    findByAuthorAndWorldName: vi.fn(),
    findByAuthorAndAlias: vi.fn(),
    findState: vi.fn(),
    /** 鍵を確かめられない作者（作者のサーバーへの取得の上限を使い切られたときなど） */
    pending: new Set<string>(),
    /** 鍵を作者のものと確かめられなかった作者（確認が 24 時間より古く、その内容を前に確かめていないときなど） */
    unconfirmed: new Set<string>(),
}));

vi.mock('../../lib/safeFetch', () => ({
    safeFetch: vi.fn(async (url: string) => {
        const file = mocks.files.get(url);
        if (file === 'down') throw new Error('ECONNREFUSED');
        return file
            ? new Response(file.body || null, { status: file.status ?? 200, headers: file.headers })
            : new Response(null, { status: 404 });
    }),
    assertPublicUrl: vi.fn(),
}));
vi.mock('../authors/authorKeyService', () => ({
    isAuthorKey: vi.fn(async (author: string) =>
        mocks.pending.has(author)
            ? { status: 'pending' }
            : mocks.unconfirmed.has(author)
              ? { status: 'unconfirmed' }
              : { status: 'confirmed' },
    ),
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
    mocks.pending.clear();
    mocks.unconfirmed.clear();
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

    it('正規の URL が無い（404。消した・名前を変えた）ならパブリック', async () => {
        const url = mirror('gone');
        await host(url, 'aya@author.example', 'gone');
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).not.toHaveProperty('reason');
    });

    it('正規の URL を確かめられない（429・5xx・通信の失敗）なら、見せはするが部屋は作らない（503 で試し直す）', async () => {
        mocks.files.set(canonical('down'), 'down');
        mocks.files.set(canonical('busy'), { body: '', status: 429 });
        for (const name of ['down', 'busy']) {
            const url = mirror(name);
            await host(url, 'aya@author.example', name);
            const resolution = await worldRegistry.resolveRefDetailed(url);
            expect(resolution.ok && resolution.world.visibilityUnconfirmed).toBe(true);
            expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ reason: 'retry' });
        }
        expect(mocks.created).toEqual([]);
    });

    it('前に private と確かめたら、確かめられなくなっても private のまま', async () => {
        await host(canonical('sticky'), 'aya@author.example', 'sticky', { [WORLD_VISIBILITY_HEADER]: 'private' });
        const first = mirror('sticky');
        await host(first, 'aya@author.example', 'sticky');
        expect(await instanceManager.createInstance({ worldId: first }, 'bob')).toMatchObject({ reason: 'forbidden' });
        mocks.files.set(canonical('sticky'), 'down');
        const second = mirror('sticky');
        await host(second, 'aya@author.example', 'sticky');
        expect(await instanceManager.createInstance({ worldId: second }, 'bob')).toMatchObject({ reason: 'forbidden' });
    });

    it('同じドメインへ取りに行く回数に上限がある（解決の API から読ませ続けて、作者のサーバーに 429 を返させない）', async () => {
        const { safeFetch } = await import('../../lib/safeFetch');
        const host2 = `flood-${Math.random().toString(36).slice(2)}.example`;
        const urls = Array.from({ length: 130 }, (_, i) => `https://${host2}/w${i}.yaml`);
        for (const url of urls) mocks.files.set(url, { body: yaml.stringify(definitionOf('flood')) });
        vi.mocked(safeFetch).mockClear();
        await Promise.all(urls.map((url) => worldRegistry.resolveRefDetailed(url)));
        const yamlFetches = vi.mocked(safeFetch).mock.calls.filter(([u]) => String(u).endsWith('.yaml'));
        expect(yamlFetches).toHaveLength(120);
    });

    it('正規の URL から取っても、ヘッダーが private なら閉じる', async () => {
        await host(canonical('direct'), 'aya@author.example', 'direct', { [WORLD_VISIBILITY_HEADER]: 'private' });
        expect(await instanceManager.createInstance({ worldId: canonical('direct') }, 'bob')).toMatchObject({
            reason: 'forbidden',
        });
    });

    it('期限を過ぎた public は使わない: 正規の URL を確かめられなければ 503（上限を使い切らせても古い public で開かない）', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(new Date('2026-11-23T00:00:00Z'));
            await host(canonical('aging'), 'aya@author.example', 'aging', { [WORLD_VISIBILITY_HEADER]: 'public' });
            const url = mirror('aging');
            await host(url, 'aya@author.example', 'aging');
            expect(await instanceManager.createInstance({ worldId: url }, 'bob')).not.toHaveProperty('reason');
            // 作者がプライベートにしたあと、作者のサーバーに届かなくなった（429 にさせられた）
            mocks.files.set(canonical('aging'), { body: '', status: 429 });
            vi.setSystemTime(new Date('2026-11-23T00:05:01Z'));
            expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({
                reason: 'retry',
                error: expect.stringContaining('作者のサーバーで公開範囲を確かめられない'),
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('署名の無い写しは作者の公開範囲と関係なく作れる（別のワールド。保証しないこと）', async () => {
        await host(canonical('nosig'), 'aya@author.example', 'nosig', { [WORLD_VISIBILITY_HEADER]: 'private' });
        const url = mirror('nosig');
        mocks.files.set(url, { body: yaml.stringify(definitionOf('nosig')) });
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).not.toHaveProperty('reason');
    });
});

describe('作者を確かめられない（確認待ち・確認が古い）写し', () => {
    const canonical = (name: string) => `https://author.example/api/v1/authors/aya/worlds/${name}.yaml`;

    it('ほかのサーバーの作者: 正規の URL が private なら、確かめられなくても 403（取得の上限を使い切らせても抜けない）', async () => {
        mocks.pending.add('aya@author.example');
        await host(canonical('locked'), 'aya@author.example', 'locked', { [WORLD_VISIBILITY_HEADER]: 'private' });
        const url = mirror('locked');
        await host(url, 'aya@author.example', 'locked');
        const resolution = await worldRegistry.resolveRefDetailed(url);
        expect(resolution.ok && resolution.world.identity).toMatchObject({ authorPending: true });
        expect(resolution.ok && resolution.world.visibility).toBe('private');
        for (const user of LOCAL_USERS) {
            expect(await instanceManager.createInstance({ worldId: url }, user)).toMatchObject({ reason: 'forbidden' });
        }
    });

    it('作者を確かめられなくても、正規の URL が期限の内に public と決まれば作れる（決め方は 1 つ）', async () => {
        mocks.pending.add('aya@author.example');
        await host(canonical('wait'), 'aya@author.example', 'wait', { [WORLD_VISIBILITY_HEADER]: 'public' });
        const url = mirror('wait');
        await host(url, 'aya@author.example', 'wait');
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).not.toHaveProperty('reason');
    });

    it('確認が古い（24 時間より前）作者は unconfirmed になるが、名乗る作者で正規の URL を確かめる: private なら 403、public なら作れる', async () => {
        mocks.unconfirmed.add('aya@author.example');
        await host(canonical('stale'), 'aya@author.example', 'stale', { [WORLD_VISIBILITY_HEADER]: 'private' });
        const url = mirror('stale');
        await host(url, 'aya@author.example', 'stale');
        const resolution = await worldRegistry.resolveRefDetailed(url);
        expect(resolution.ok && resolution.world.identity).toMatchObject({ claimedAuthor: 'aya@author.example' });
        expect(resolution.ok && resolution.world.identity).not.toHaveProperty('author');
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ reason: 'forbidden' });

        await host(canonical('stale-open'), 'aya@author.example', 'stale-open', {
            [WORLD_VISIBILITY_HEADER]: 'public',
        });
        const open = mirror('stale-open');
        await host(open, 'aya@author.example', 'stale-open');
        expect(await instanceManager.createInstance({ worldId: open }, 'bob')).not.toHaveProperty('reason');
    });

    it('このサーバーの作者のプライベートのワールドを名乗れば（確かめられなくても）403。パブリックなら作れるが作者の ID は付けない', async () => {
        mocks.pending.add('aya@ubichill.example');
        await ayaWorld('secret2', 'private');
        const url = mirror('claim');
        await host(url, 'aya@ubichill.example', 'secret2');
        expect(await instanceManager.createInstance({ worldId: url }, 'bob')).toMatchObject({ reason: 'forbidden' });
        // 作者本人の ID でも、名乗っているだけの写しからは作れない（作者の ID を付けない）
        expect(await instanceManager.createInstance({ worldId: url }, AYA_ID)).toMatchObject({ reason: 'forbidden' });

        // このサーバーのワールドの方は確かめ終えている（DB の作者の確認が落ちるのは写しを読む間だけ）
        mocks.pending.clear();
        await ayaWorld('open2', 'public');
        expect((await worldRegistry.getWorld('db-open2'))?.visibility).toBe('public');
        mocks.pending.add('aya@ubichill.example');
        const open = mirror('claim-open');
        await host(open, 'aya@ubichill.example', 'open2');
        const resolution = await worldRegistry.resolveRefDetailed(open);
        expect(resolution.ok && resolution.world.authorId).toBeUndefined();
        // このサーバーの作者のパブリックのワールドはだれでも作れる（名乗りからは作者の ID を付けない）
        expect(await instanceManager.createInstance({ worldId: open }, 'bob')).not.toHaveProperty('reason');
    });
});

describe('正規の URL の確かめ方', () => {
    it('http・ほかのポートで同じパスに置いたもの（ヘッダー無し）も、https の正規の URL を確かめる', async () => {
        await host('https://author.example/api/v1/authors/aya/worlds/scheme.yaml', 'aya@author.example', 'scheme', {
            [WORLD_VISIBILITY_HEADER]: 'private',
        });
        for (const url of [
            'http://author.example/api/v1/authors/aya/worlds/scheme.yaml',
            'https://author.example:8443/api/v1/authors/aya/worlds/scheme.yaml',
        ]) {
            await host(url, 'aya@author.example', 'scheme');
            expect(await instanceManager.createInstance({ worldId: url }, 'bob'), url).toMatchObject({
                reason: 'forbidden',
            });
        }
    });
});
