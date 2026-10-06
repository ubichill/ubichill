import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signWorld } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yaml from 'yaml';
import { runVerifyWorld } from './verifyWorldFile';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from './worldCrypto';

// RFC 8032 §7.1 TEST 1（空メッセージ）。PKCS8 = 固定プレフィックス + 32byte seed。
const RFC8032_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC8032_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC8032_SIG =
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

const VALID_WORLD_YAML = [
    'apiVersion: ubichill.com/v1alpha1',
    'kind: World',
    'metadata:',
    '  name: my-world',
    '  version: 1.0.0',
    'spec:',
    '  displayName: A',
    '  capacity: { default: 2, max: 4 }',
    '  initialEntities: []',
    '',
].join('\n');

const hexToBase64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');
const hexToBase64Url = (hex: string): string => Buffer.from(hex, 'hex').toString('base64url');

describe('worldCrypto（WebCrypto 実装）', () => {
    it('RFC 8032 のテストベクタと一致する（鍵の取り込み・公開鍵導出・署名）', async () => {
        const key = await importSigningKey(hexToBase64(`302e020100300506032b657004220420${RFC8032_SEED}`));
        expect(key.publicKey).toBe(hexToBase64Url(RFC8032_PUBLIC));
        expect(await key.sign('')).toBe(hexToBase64Url(RFC8032_SIG));
        expect(await webWorldCrypto.verifyEd25519(key.publicKey, '', hexToBase64Url(RFC8032_SIG))).toBe(true);
    });

    it('sha256 は既知値と一致する', async () => {
        expect(await webWorldCrypto.sha256Base64('abc')).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    });

    it('壊れた鍵・署名でも throw せず false', async () => {
        expect(await webWorldCrypto.verifyEd25519('短すぎる', 'm', 'x')).toBe(false);
    });
});

describe('ubichill verify <world.yaml>（署名が今の内容に対して有効か）', () => {
    const dir = { path: '' };
    const world = () => join(dir.path, 'w.yaml');
    const sig = () => join(dir.path, 'w.sig.json');
    const writeSigned = async (author?: string) => {
        const key = await importSigningKey(await generateSigningKeyPkcs8());
        const signature = await signWorld(
            { definition: yaml.parse(VALID_WORLD_YAML), lock: null },
            key,
            webWorldCrypto,
            {
                author,
            },
        );
        writeFileSync(sig(), JSON.stringify(signature));
    };

    beforeEach(() => {
        dir.path = mkdtempSync(join(tmpdir(), 'ubichill-verify-'));
        writeFileSync(world(), VALID_WORLD_YAML);
        process.exitCode = undefined;
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        rmSync(dir.path, { recursive: true, force: true });
        process.exitCode = undefined;
        vi.restoreAllMocks();
    });

    it('作者付きの有効な署名は合格', async () => {
        await writeSigned('youkan@ubichill.com');
        await runVerifyWorld([world()]);
        expect(process.exitCode).toBeUndefined();
    });

    it('署名の後に内容が変わると不合格', async () => {
        await writeSigned('youkan@ubichill.com');
        writeFileSync(world(), VALID_WORLD_YAML.replace('displayName: A', 'displayName: B'));
        await runVerifyWorld([world()]);
        expect(process.exitCode).toBe(1);
    });

    it('署名ファイルが無ければ不合格（未署名を合格にしない）', async () => {
        await runVerifyWorld([world()]);
        expect(process.exitCode).toBe(1);
    });

    it('作者アカウントの無い署名は不合格（公開されないため）', async () => {
        await writeSigned(undefined);
        await runVerifyWorld([world()]);
        expect(process.exitCode).toBe(1);
    });

    it('YAML 以外を渡したら使い方を示す', async () => {
        await expect(runVerifyWorld(['w.json'])).rejects.toThrow(/usage/);
    });
});
