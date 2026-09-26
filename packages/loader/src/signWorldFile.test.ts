import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorldSignatureSchema, worldIdOf } from '@ubichill/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSigningKeyFile, runKeygen, runSign, signAfterInstall } from './signWorldFile';
import { importSigningKey, webWorldCrypto } from './worldCrypto';

// RFC 8032 §7.1 TEST 1（空メッセージ）。PKCS8 = 固定プレフィックス + 32byte seed。
const RFC8032_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RFC8032_PUBLIC = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC8032_SIG =
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';

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

describe('ubichill keygen / sign', () => {
    const dir = { path: '' };
    const world = () => join(dir.path, 'w.yaml');
    const lock = () => join(dir.path, 'w.lock.json');
    const sig = () => join(dir.path, 'w.sig.json');
    const keyFile = () => join(dir.path, 'k.key');

    beforeEach(async () => {
        dir.path = mkdtempSync(join(tmpdir(), 'ubichill-sign-'));
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        writeFileSync(world(), 'metadata:\n  name: my-world\nspec:\n  displayName: A\n');
        writeFileSync(lock(), JSON.stringify({ lockVersion: 1, mods: {} }));
        await runKeygen([`--out=${keyFile()}`]);
    });

    afterEach(() => {
        process.exitCode = 0;
        vi.restoreAllMocks();
        rmSync(dir.path, { recursive: true, force: true });
    });

    it('署名すると公開鍵 + name の worldId を持つ有効な sig.json が出る', async () => {
        await runSign([world(), `--key-file=${keyFile()}`]);
        const written = WorldSignatureSchema.parse(JSON.parse(readFileSync(sig(), 'utf-8')));
        const { publicKey } = await importSigningKey(readFileSync(keyFile(), 'utf-8'));
        expect(written.publicKey).toBe(publicKey);
        expect(worldIdOf(written.publicKey, written.name)).toBe(worldIdOf(publicKey, 'my-world'));

        await runSign([world(), '--check']);
        expect(process.exitCode ?? 0).toBe(0);
    });

    it('署名後に lock を再生成すると --check が失敗する', async () => {
        await runSign([world(), `--key-file=${keyFile()}`]);
        writeFileSync(lock(), JSON.stringify({ lockVersion: 1, mods: { pen: { id: 'pen' } } }));
        await runSign([world(), '--check']);
        expect(process.exitCode).toBe(1);
    });

    it('署名ファイルが無い --check は失敗する（未署名を合格にしない）', async () => {
        await runSign([world(), '--check']);
        expect(process.exitCode).toBe(1);
    });

    it('keygen は既存の鍵を上書きしない', async () => {
        const before = readFileSync(keyFile(), 'utf-8');
        await expect(runKeygen([`--out=${keyFile()}`])).rejects.toThrow();
        expect(readFileSync(keyFile(), 'utf-8')).toBe(before);
    });

    it('鍵が無ければ署名を拒否する', async () => {
        vi.stubEnv('HOME', dir.path);
        vi.stubEnv('UBICHILL_SIGNING_KEY', '');
        vi.stubEnv('UBICHILL_SIGNING_KEY_FILE', '');
        await expect(runSign([world()])).rejects.toThrow(/署名鍵/);
        vi.unstubAllEnvs();
    });
});

describe('既定の鍵の場所と install 後の自動署名', () => {
    const dir = { path: '' };
    const world = () => join(dir.path, 'w.yaml');
    const sig = () => join(dir.path, 'w.sig.json');

    beforeEach(() => {
        dir.path = mkdtempSync(join(tmpdir(), 'ubichill-autosign-'));
        vi.stubEnv('HOME', dir.path);
        vi.stubEnv('UBICHILL_SIGNING_KEY', '');
        vi.stubEnv('UBICHILL_SIGNING_KEY_FILE', '');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        writeFileSync(world(), 'metadata:\n  name: my-world\nspec:\n  displayName: A\n');
        writeFileSync(join(dir.path, 'w.lock.json'), JSON.stringify({ lockVersion: 1, mods: {} }));
    });

    afterEach(() => {
        process.exitCode = 0;
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        rmSync(dir.path, { recursive: true, force: true });
    });

    it('keygen の既定はリポジトリ外（~/.config/ubichill/signing.key）で、所有者のみ読める', async () => {
        await runKeygen([]);
        expect(defaultSigningKeyFile().startsWith(dir.path)).toBe(true);
        expect(statSync(defaultSigningKeyFile()).mode & 0o077).toBe(0);
    });

    it('鍵が無ければ署名せず警告する（黙って署名なしにしない）', async () => {
        await signAfterInstall(world(), []);
        expect(existsSync(sig())).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('署名なし'));
    });

    it('既定の場所に鍵があれば自動で署名し、sign --check が通る', async () => {
        await runKeygen([]);
        await signAfterInstall(world(), []);
        await runSign([world(), '--check']);
        expect(process.exitCode ?? 0).toBe(0);
    });

    it('別の鍵で署名済みなら上書きしない（作者が変わってしまうため）', async () => {
        const other = join(dir.path, 'other.key');
        await runKeygen([`--out=${other}`]);
        await runSign([world(), `--key-file=${other}`]);
        const before = readFileSync(sig(), 'utf-8');
        await runKeygen([]);
        await signAfterInstall(world(), []);
        expect(readFileSync(sig(), 'utf-8')).toBe(before);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('別の鍵'));
    });

    it('同じ鍵なら lock 変更後に署名し直して有効に戻る', async () => {
        await runKeygen([]);
        await signAfterInstall(world(), []);
        writeFileSync(join(dir.path, 'w.lock.json'), JSON.stringify({ lockVersion: 1, mods: { pen: { id: 'pen' } } }));
        await signAfterInstall(world(), []);
        await runSign([world(), '--check']);
        expect(process.exitCode ?? 0).toBe(0);
    });
});

describe('作者アカウント（--author / UBICHILL_AUTHOR）', () => {
    const dir = { path: '' };
    const world = () => join(dir.path, 'w.yaml');
    const keyFile = () => join(dir.path, 'k.key');

    beforeEach(async () => {
        dir.path = mkdtempSync(join(tmpdir(), 'ubichill-author-'));
        vi.stubEnv('HOME', dir.path);
        vi.stubEnv('UBICHILL_AUTHOR', '');
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        writeFileSync(world(), 'metadata:\n  name: my-world\nspec:\n  displayName: A\n');
        await runKeygen([`--out=${keyFile()}`]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        rmSync(dir.path, { recursive: true, force: true });
    });

    const written = () => WorldSignatureSchema.parse(JSON.parse(readFileSync(join(dir.path, 'w.sig.json'), 'utf-8')));

    it('--author を署名に載せる（@ 付き・大文字ドメインは正規化）', async () => {
        await runSign([world(), `--key-file=${keyFile()}`, '--author=@youkan@UbiChill.com']);
        expect(written().author).toBe('youkan@ubichill.com');
    });

    it('env UBICHILL_AUTHOR でも指定できる', async () => {
        vi.stubEnv('UBICHILL_AUTHOR', 'youkan@ubichill.com');
        await runSign([world(), `--key-file=${keyFile()}`]);
        expect(written().author).toBe('youkan@ubichill.com');
    });

    it('指定しなければ author を載せない', async () => {
        await runSign([world(), `--key-file=${keyFile()}`]);
        expect(written().author).toBeUndefined();
    });

    it('形式が不正なら署名しない', async () => {
        await expect(runSign([world(), `--key-file=${keyFile()}`, '--author=youkan'])).rejects.toThrow(/形式/);
    });
});
