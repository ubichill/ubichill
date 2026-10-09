import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    type AuthorKeyCheck,
    type ModLockEntry,
    type ModSignatureVerdict,
    signMod,
    type WorldSigningKey,
} from '@ubichill/shared';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nodeWorldCrypto } from '../services/worldCrypto';
import { createModsRouter } from './mods';

function newKey(): WorldSigningKey {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signWith = (key: KeyObject) => async (message: string) =>
        sign(null, Buffer.from(message, 'utf8'), key).toString('base64url');
    return { publicKey: publicKey.export({ format: 'jwk' }).x ?? '', sign: signWith(privateKey) };
}

const integrity = (c: string) => `sha256-${c.repeat(43)}=`;
const entry: ModLockEntry = {
    id: 'pen',
    version: '2.0.1',
    manifestIntegrity: integrity('A'),
    components: { 'pen:pen': { workerUrl: './pen/index.js', integrity: integrity('B'), capabilities: ['net:fetch'] } },
};

const AUTHOR = 'alice@example.com';
const alice = newKey();
const lookups: { author: string; contentHash: string }[] = [];
const isAuthorKey: AuthorKeyCheck = async (author, publicKey, contentHash) => {
    lookups.push({ author, contentHash });
    return author === AUTHOR && publicKey === alice.publicKey ? { status: 'confirmed' } : { status: 'unconfirmed' };
};

const app = express();
app.use(express.json());
app.use('/api/v1/mods', createModsRouter({ crypto: nodeWorldCrypto, isAuthorKey }));
const server = createServer(app);

const verify = async (body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/mods/signature/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as ModSignatureVerdict };
};

describe('POST /api/v1/mods/signature/verify', () => {
    beforeAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
    });
    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    });
    beforeEach(() => {
        lookups.length = 0;
    });

    it('作者の鍵による署名（本物の ed25519）を、その作者として確認する', async () => {
        const signature = await signMod(entry, alice, nodeWorldCrypto, { author: AUTHOR });
        const res = await verify({ entry, signature });
        expect(res).toMatchObject({ status: 200, body: { status: 'verified', author: AUTHOR } });
        expect(lookups).toHaveLength(1);
    });

    it('作者アカウントを名乗るだけ（署名なし・でたらめな署名）では、作者の確認まで進まない', async () => {
        const signature = await signMod(entry, alice, nodeWorldCrypto, { author: AUTHOR });
        const forged = [
            { entry },
            { entry, signature: null },
            { entry, signature: { ...signature, signature: 'A'.repeat(86) } },
            { entry: { ...entry, manifestIntegrity: integrity('C') }, signature },
        ];
        const reasons = await Promise.all(forged.map(async (body) => (await verify(body)).body));
        expect(reasons).toEqual([
            { status: 'rejected', reason: 'signature-missing' },
            { status: 'rejected', reason: 'signature-missing' },
            { status: 'rejected', reason: 'signature-invalid' },
            { status: 'rejected', reason: 'signature-content-mismatch' },
        ]);
        expect(lookups).toEqual([]);
    });

    it('他人の作者アカウントを名乗って自分の鍵で署名しても確認されない', async () => {
        const signature = await signMod(entry, newKey(), nodeWorldCrypto, { author: AUTHOR });
        expect((await verify({ entry, signature })).body).toEqual({ status: 'rejected', reason: 'author-unconfirmed' });
    });

    it('lock の形をしていない依頼は 400', async () => {
        for (const body of [{}, { entry: { id: 'pen' } }, { entry: 'pen', signature: {} }, []]) {
            expect((await verify(body)).status).toBe(400);
        }
        expect(lookups).toEqual([]);
    });
});
