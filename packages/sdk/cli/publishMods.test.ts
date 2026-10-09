import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from '@ubichill/loader';
import { type ModLockEntry, verifyModSignature } from '@ubichill/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { listDirsOnDisk } from './modLayout.ts';
import { type PublishModsDeps, publishMods } from './publishMods.ts';
import { verifyAllModSignatures } from './verify.ts';

const credential = { account: 'alice@example.com' };
const integrity = (c: string) => `sha256-${c.repeat(43)}=`;
const lockOf = (id: string, version: string): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: integrity('A'),
    components: { [`${id}:main`]: { workerUrl: './main/index.js', integrity: integrity('B'), capabilities: [] } },
});

/** パス → 中身のメモリ上のファイル群（ディレクトリはパスから導く）。 */
function memoryFs(files: Record<string, string>): PublishModsDeps['fs'] {
    return {
        readText: (path) => files[path],
        writeText: (path, text) => {
            files[path] = text;
        },
        listDirs: (path) => [
            ...new Set(
                Object.keys(files)
                    .filter((p) => p.startsWith(`${path}/`))
                    .map((p) => p.slice(path.length + 1).split('/'))
                    .filter((parts) => parts.length > 1)
                    .map((parts) => parts[0] ?? ''),
            ),
        ],
    };
}

async function depsFor(files: Record<string, string>) {
    const key = await importSigningKey(await generateSigningKeyPkcs8());
    const deps: PublishModsDeps = { fs: memoryFs(files), key, crypto: webWorldCrypto, log: () => undefined };
    return { deps, key };
}

describe('publishMods', () => {
    it('出力にある全 mod・全版に、ログインしたアカウントで署名する', async () => {
        const files: Record<string, string> = {
            'dist/mods/index.json': '[]',
            'dist/mods/pen/mod.json': '{}',
            'dist/mods/pen/v1.0.0/lock.json': JSON.stringify(lockOf('pen', '1.0.0')),
            'dist/mods/pen/v1.1.0/lock.json': JSON.stringify(lockOf('pen', '1.1.0')),
            'dist/mods/danmaku/v2.0.0/lock.json': JSON.stringify(lockOf('danmaku', '2.0.0')),
        };
        const { deps, key } = await depsFor(files);
        const written = await publishMods(deps, { modsDir: 'dist/mods', credential });
        expect(written.sort()).toEqual([
            'dist/mods/danmaku/v2.0.0/lock.sig.json',
            'dist/mods/pen/v1.0.0/lock.sig.json',
            'dist/mods/pen/v1.1.0/lock.sig.json',
        ]);
        const signature = JSON.parse(files['dist/mods/pen/v1.1.0/lock.sig.json'] ?? '') as unknown;
        const verdict = await verifyModSignature(lockOf('pen', '1.1.0'), signature, webWorldCrypto, async (a, k) =>
            a === credential.account && k === key.publicKey ? { status: 'confirmed' } : { status: 'unconfirmed' },
        );
        expect(verdict).toMatchObject({ status: 'verified', author: 'alice@example.com' });
        // 別の版の署名としては使えない
        expect(await verifyModSignature(lockOf('pen', '1.0.0'), signature, webWorldCrypto)).toMatchObject({
            reason: 'signature-mod-mismatch',
        });
    });

    it('CLI（WebCrypto）の署名は、サーバーと同じ node:crypto の検証でも通る', async () => {
        const files: Record<string, string> = { 'out/pen/v1.0.0/lock.json': JSON.stringify(lockOf('pen', '1.0.0')) };
        const { deps } = await depsFor(files);
        await publishMods(deps, { modsDir: 'out', credential });
        const nodeCrypto = {
            sha256Base64: async (text: string) => createHash('sha256').update(text, 'utf8').digest('base64'),
            verifyEd25519: async (publicKey: string, message: string, signature: string) =>
                verify(
                    null,
                    Buffer.from(message, 'utf8'),
                    createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }),
                    Buffer.from(signature, 'base64url'),
                ),
        };
        const signature = JSON.parse(files['out/pen/v1.0.0/lock.sig.json'] ?? '') as unknown;
        const confirmed = async () => ({ status: 'confirmed' }) as const;
        expect(await verifyModSignature(lockOf('pen', '1.0.0'), signature, nodeCrypto, confirmed)).toMatchObject({
            status: 'verified',
        });
        const tampered = { ...lockOf('pen', '1.0.0'), manifestIntegrity: integrity('Z') };
        expect(await verifyModSignature(tampered, signature, nodeCrypto, confirmed)).toMatchObject({
            reason: 'signature-content-mismatch',
        });
    });

    it('単体 mod の出力（<dir>/v<version>/）にも署名する', async () => {
        const files: Record<string, string> = {
            'dist/index.json': '[]',
            'dist/v3.0.0/lock.json': JSON.stringify(lockOf('video-player', '3.0.0')),
            'dist/v3.1.0/lock.json': JSON.stringify(lockOf('video-player', '3.1.0')),
            'dist/v3.1.0/screen/index.js': '',
        };
        const { deps } = await depsFor(files);
        expect((await publishMods(deps, { modsDir: 'dist', credential })).sort()).toEqual([
            'dist/v3.0.0/lock.sig.json',
            'dist/v3.1.0/lock.sig.json',
        ]);
    });

    it('v で始まる mod の ID（video-player）を、版のディレクトリと取り違えない', async () => {
        const files: Record<string, string> = {
            'out/video-player/v3.1.0/lock.json': JSON.stringify(lockOf('video-player', '3.1.0')),
            'out/pen/v1.0.0/lock.json': JSON.stringify(lockOf('pen', '1.0.0')),
        };
        const { deps } = await depsFor(files);
        expect((await publishMods(deps, { modsDir: 'out', credential })).sort()).toEqual([
            'out/pen/v1.0.0/lock.sig.json',
            'out/video-player/v3.1.0/lock.sig.json',
        ]);
    });

    it('lock の無いディレクトリ（データだけの mod など）は飛ばす', async () => {
        const files: Record<string, string> = {
            'out/pen/v1.0.0/lock.json': JSON.stringify(lockOf('pen', '1.0.0')),
            'out/data/v1.0.0/manifest.json': '{}',
            'out/pen/vendor/readme.txt': 'x',
        };
        const { deps } = await depsFor(files);
        expect(await publishMods(deps, { modsDir: 'out', credential })).toEqual(['out/pen/v1.0.0/lock.sig.json']);
    });

    it('置き場所と中身が違う lock には署名しない（別の mod の lock を置かれても、その名前で署名しない）', async () => {
        for (const [path, lock] of [
            ['out/pen/v1.0.0/lock.json', lockOf('evil', '1.0.0')],
            ['out/pen/v1.0.0/lock.json', lockOf('pen', '9.9.9')],
        ] as const) {
            const files: Record<string, string> = { [path]: JSON.stringify(lock) };
            const { deps } = await depsFor(files);
            await expect(publishMods(deps, { modsDir: 'out', credential })).rejects.toThrow('置き場所');
            expect(Object.keys(files)).toEqual([path]);
        }
    });

    it('lock として読めないファイルがあれば、どれにも署名せず失敗する', async () => {
        const files: Record<string, string> = {
            'out/a/v1.0.0/lock.json': JSON.stringify(lockOf('a', '1.0.0')),
            'out/b/v1.0.0/lock.json': JSON.stringify({ id: 'b' }),
        };
        const { deps } = await depsFor(files);
        await expect(publishMods(deps, { modsDir: 'out', credential })).rejects.toThrow('lock として読めません');
        expect(Object.keys(files).filter((p) => p.endsWith('.sig.json'))).toEqual([]);
    });

    it('署名する mod が 1 つも無ければ失敗する（パスの指定ミス）', async () => {
        const { deps } = await depsFor({ 'out/readme.txt': 'x' });
        await expect(publishMods(deps, { modsDir: 'out', credential })).rejects.toThrow('署名する mod がありません');
    });
});

describe('verifyAllModSignatures', () => {
    const dirs: string[] = [];
    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    /** 実ファイルに lock を置き、publishMods で署名した出力を作る。 */
    async function signedOutput() {
        const root = mkdtempSync(join(tmpdir(), 'ubichill-sig-'));
        dirs.push(root);
        const lockPath = join(root, 'pen', 'v1.0.0', 'lock.json');
        mkdirSync(dirname(lockPath), { recursive: true });
        writeFileSync(lockPath, JSON.stringify(lockOf('pen', '1.0.0')));
        const key = await importSigningKey(await generateSigningKeyPkcs8());
        const sigPath = join(root, 'pen', 'v1.0.0', 'lock.sig.json');
        await publishMods(
            {
                fs: {
                    readText: (p) => readFileSync(p, 'utf-8'),
                    writeText: (p, t) => writeFileSync(p, t),
                    listDirs: listDirsOnDisk,
                },
                key,
                crypto: webWorldCrypto,
                log: () => undefined,
            },
            { modsDir: root, credential },
        );
        return { root, lockPath, sigPath };
    }

    it('署名した直後の出力は合格する', async () => {
        const { root } = await signedOutput();
        expect(await verifyAllModSignatures(root, true)).toEqual([]);
    });

    it('署名のあとに lock を変えると不合格（署名を必須にしていなくても）', async () => {
        const { root, lockPath } = await signedOutput();
        writeFileSync(lockPath, JSON.stringify({ ...lockOf('pen', '1.0.0'), manifestIntegrity: integrity('Z') }));
        expect(await verifyAllModSignatures(root, false)).toEqual([
            expect.stringContaining('signature-content-mismatch'),
        ]);
    });

    it('壊れた署名ファイルは不合格', async () => {
        const { root, sigPath } = await signedOutput();
        writeFileSync(sigPath, '<!doctype html>');
        expect(await verifyAllModSignatures(root, false)).toEqual([expect.stringContaining('signature-malformed')]);
    });

    it('署名が無い出力は、必須のときだけ不合格', async () => {
        const { root, sigPath } = await signedOutput();
        rmSync(sigPath);
        expect(await verifyAllModSignatures(root, false)).toEqual([]);
        expect(await verifyAllModSignatures(root, true)).toEqual([expect.stringContaining('署名がありません')]);
    });
});
