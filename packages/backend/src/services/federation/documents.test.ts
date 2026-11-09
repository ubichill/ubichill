import { randomBytes } from 'node:crypto';
import { DEFAULT_FEDIVERSE_SETTINGS } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { createLocalActors, type LocalUser } from './documents';
import { createFederationIdentity } from './identity';
import { createKeyring } from './keys';
import type { RsaKeyring } from './rsaKeys';

const identity = createFederationIdentity('https://api.example');
const rsaKeys: RsaKeyring = {
    signerFor: async (actorId) => ({ keyId: `${actorId}#main-key`, publicKeyPem: 'PEM', sign: () => new Uint8Array() }),
};

const alice: LocalUser = {
    id: 'alice',
    handle: 'alice',
    name: 'Alice',
    bio: '1 行目\n2 行目',
    image: '/api/v1/users/alice/images/avatar/a.webp',
    banner: '/api/v1/users/alice/images/banner/b.webp',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    profile: {
        status: 'ねむい',
        links: [{ url: 'https://github.com/alice', kind: 'github' }],
        languages: ['ja'],
    },
};

const actors = createLocalActors({
    identity,
    keyring: createKeyring({ seed: randomBytes(32) }),
    rsaKeys,
    findUser: async (id) => (id === alice.id ? alice : undefined),
    settingsOf: async () => DEFAULT_FEDIVERSE_SETTINGS,
    followerCount: async () => 0,
    profileOrigin: 'https://app.example',
});

describe('このサーバーの人の actor の文書', () => {
    it('プロフィールの画面に出しているものをすべて載せる（アイコン・バナーは API のオリジンで絶対 URL）', async () => {
        const doc = await actors.person('alice');
        expect(doc).toMatchObject({
            name: 'Alice',
            summary: '<p>1 行目<br>2 行目</p>',
            url: 'https://app.example/@alice',
            icon: { type: 'Image', url: 'https://api.example/api/v1/users/alice/images/avatar/a.webp' },
            image: { type: 'Image', url: 'https://api.example/api/v1/users/alice/images/banner/b.webp' },
            published: '2026-01-02T03:04:05.000Z',
            statusMessage: 'ねむい',
            spokenLanguages: ['ja'],
        });
        expect(((doc?.attachment ?? []) as Array<{ name: string }>).map((f) => f.name)).toEqual([
            'GitHub',
            '話せる言語',
            'ひとこと',
        ]);
    });

    it('バナー・項目が無ければ載せない', async () => {
        const bare = createLocalActors({
            identity,
            keyring: createKeyring({ seed: randomBytes(32) }),
            rsaKeys,
            findUser: async () => ({
                ...alice,
                banner: null,
                profile: { status: null, links: [], languages: [] },
            }),
            settingsOf: async () => DEFAULT_FEDIVERSE_SETTINGS,
            followerCount: async () => 0,
            profileOrigin: 'https://app.example',
        });
        const doc = await bare.person('alice');
        expect(doc?.image).toBeUndefined();
        expect(doc?.attachment).toBeUndefined();
    });
});
