import { generateKeyPairSync, sign } from 'node:crypto';
import { type AuthorKeyCheck, type ModLockEntry, signMod, signWorld, type WorldSigningKey } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { confirmPublishedMod, type RegistrationDeps, verifyRegistration } from './externalWorks';
import { nodeWorldCrypto } from './worldCrypto';

function newKey(): WorldSigningKey {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return {
        publicKey: publicKey.export({ format: 'jwk' }).x ?? '',
        sign: async (message) => sign(null, Buffer.from(message, 'utf8'), privateKey).toString('base64url'),
    };
}

const ALICE = 'alice@ubichill.com';
const alice = newKey();
const isAuthorKey: AuthorKeyCheck = async (author, publicKey) =>
    author === ALICE && publicKey === alice.publicKey ? { status: 'confirmed' } : { status: 'unconfirmed' };
const deps: RegistrationDeps = {
    account: ALICE,
    crypto: nodeWorldCrypto,
    isAuthorKey,
    parseYaml: (text) => yaml.parse(text) as unknown,
    selfOrigin: 'https://ubichill.com',
};

const worldYaml = `apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: chillwa
  version: 1.0.0
spec:
  displayName: ちるわ
  capacity: { default: 2, max: 4 }
  initialEntities: []
`;
const integrity = (c: string) => `sha256-${c.repeat(43)}=`;
const entry: ModLockEntry = {
    id: 'video-player',
    version: '3.1.0',
    manifestIntegrity: integrity('A'),
    components: { 'video-player:screen': { workerUrl: './s.js', integrity: integrity('B'), capabilities: [] } },
};
const WORLD_URL = 'https://alice.github.io/worlds/chillwa.yaml';
const MOD_URL = 'https://alice.github.io/video';

const signedWorld = async (key = alice, author = ALICE) => ({
    kind: 'world' as const,
    url: WORLD_URL,
    yaml: worldYaml,
    lock: null,
    signature: await signWorld({ definition: yaml.parse(worldYaml), lock: null }, key, nodeWorldCrypto, { author }),
});
const signedMod = async (key = alice, author = ALICE) => ({
    kind: 'mod' as const,
    url: MOD_URL,
    entry,
    signature: await signMod(entry, key, nodeWorldCrypto, { author }),
});

describe('verifyRegistration', () => {
    it('本人が署名したワールド・mod は登録できる', async () => {
        expect(await verifyRegistration(await signedWorld(), deps)).toEqual({
            ok: true,
            work: { kind: 'world', url: WORLD_URL, name: 'chillwa', version: null },
        });
        expect(await verifyRegistration(await signedMod(), deps)).toEqual({
            ok: true,
            work: { kind: 'mod', url: MOD_URL, name: 'video-player', version: '3.1.0' },
        });
    });

    it('他人が署名した作品を、自分の作品として登録できない', async () => {
        const bob = newKey();
        const bobDeps: RegistrationDeps = {
            ...deps,
            isAuthorKey: async (author, publicKey) =>
                author === 'bob@ubichill.com' && publicKey === bob.publicKey
                    ? { status: 'confirmed' }
                    : { status: 'unconfirmed' },
        };
        // bob の作品を alice が登録しようとする
        for (const registration of [
            await signedWorld(bob, 'bob@ubichill.com'),
            await signedMod(bob, 'bob@ubichill.com'),
        ]) {
            expect(await verifyRegistration(registration, bobDeps)).toMatchObject({ ok: false, code: 'not-author' });
        }
    });

    it('自分を名乗っても、自分の鍵で署名していなければ登録できない', async () => {
        const mallory = newKey();
        expect(await verifyRegistration(await signedWorld(mallory), deps)).toMatchObject({ ok: false, status: 403 });
        expect(await verifyRegistration(await signedMod(mallory), deps)).toMatchObject({ ok: false, status: 403 });
    });

    it('署名と違う内容（書き換えた yaml・lock）は登録できない', async () => {
        const world = await signedWorld();
        expect(
            await verifyRegistration({ ...world, yaml: worldYaml.replace('ちるわ', 'べつもの') }, deps),
        ).toMatchObject({ ok: false, status: 403, code: 'content-mismatch' });
        const mod = await signedMod();
        expect(
            await verifyRegistration({ ...mod, entry: { ...entry, manifestIntegrity: integrity('C') } }, deps),
        ).toMatchObject({ ok: false, status: 403 });
    });

    it('署名の無いワールドは登録できない', async () => {
        expect(await verifyRegistration({ ...(await signedWorld()), signature: undefined }, deps)).toMatchObject({
            ok: false,
            code: 'unsigned',
        });
    });

    it('このサーバーに置いた作品は外部の作品として登録しない', async () => {
        const world = await signedWorld();
        expect(
            await verifyRegistration(
                { ...world, url: 'https://ubichill.com/api/v1/authors/alice/worlds/chillwa.yaml' },
                deps,
            ),
        ).toMatchObject({ ok: false, code: 'self-hosted' });
    });

    it('作者をいま確認できないときは 503', async () => {
        const pending: AuthorKeyCheck = async () => ({ status: 'pending' });
        expect(await verifyRegistration(await signedMod(), { ...deps, isAuthorKey: pending })).toMatchObject({
            ok: false,
            status: 503,
        });
        expect(await verifyRegistration(await signedWorld(), { ...deps, isAuthorKey: pending })).toMatchObject({
            ok: false,
            status: 503,
        });
    });

    it('読めない yaml は 400', async () => {
        const world = await signedWorld();
        expect(await verifyRegistration({ ...world, yaml: ': [' }, deps)).toMatchObject({ ok: false, status: 400 });
    });
});

describe('confirmPublishedMod', () => {
    const serve = (files: Record<string, unknown>) => async (url: string) => files[url];
    const at = (file: string) => `${MOD_URL}/video-player/v3.1.0/${file}`;
    const work = { url: MOD_URL, name: 'video-player', version: '3.1.0' };

    it('登録した URL が本人の署名付きの mod を配っていれば、表示する', async () => {
        const { signature } = await signedMod();
        const published = await confirmPublishedMod(work, {
            account: ALICE,
            crypto: nodeWorldCrypto,
            isAuthorKey,
            fetchJson: serve({ [at('lock.json')]: entry, [at('lock.sig.json')]: signature }),
        });
        expect(published).toEqual({ id: 'video-player', name: 'video-player', version: '3.1.0', url: MOD_URL });
    });

    it('まだ公開されていない・別の物が置かれている・他人の署名なら、表示しない', async () => {
        const { signature } = await signedMod();
        const bob = newKey();
        const bobSignature = await signMod(entry, bob, nodeWorldCrypto, { author: 'bob@ubichill.com' });
        const other = { ...entry, id: 'other' };
        for (const files of [
            {},
            { [at('lock.json')]: entry },
            { [at('lock.json')]: { ...entry, manifestIntegrity: integrity('C') }, [at('lock.sig.json')]: signature },
            {
                [at('lock.json')]: other,
                [at('lock.sig.json')]: await signMod(other, alice, nodeWorldCrypto, { author: ALICE }),
            },
            { [at('lock.json')]: entry, [at('lock.sig.json')]: bobSignature },
        ]) {
            const published = await confirmPublishedMod(work, {
                account: ALICE,
                crypto: nodeWorldCrypto,
                isAuthorKey: async (author, publicKey) =>
                    (author === ALICE && publicKey === alice.publicKey) ||
                    (author === 'bob@ubichill.com' && publicKey === bob.publicKey)
                        ? { status: 'confirmed' }
                        : { status: 'unconfirmed' },
                fetchJson: serve(files),
            });
            expect(published).toBeUndefined();
        }
    });

    it('鍵を取り消したら表示しない', async () => {
        const { signature } = await signedMod();
        const published = await confirmPublishedMod(work, {
            account: ALICE,
            crypto: nodeWorldCrypto,
            isAuthorKey: async () => ({ status: 'unconfirmed' }),
            fetchJson: serve({ [at('lock.json')]: entry, [at('lock.sig.json')]: signature }),
        });
        expect(published).toBeUndefined();
    });

    it('mod の ID・版に URL として特別な文字があっても、別の場所を取りに行かない', async () => {
        const fetched: string[] = [];
        await confirmPublishedMod(
            { url: MOD_URL, name: '../x?y', version: '1.0.0#z' },
            {
                account: ALICE,
                crypto: nodeWorldCrypto,
                isAuthorKey,
                fetchJson: async (url) => {
                    fetched.push(url);
                    return undefined;
                },
            },
        );
        expect(fetched.every((url) => url.startsWith(`${MOD_URL}/..%2Fx%3Fy/v1.0.0%23z/`))).toBe(true);
    });
});
