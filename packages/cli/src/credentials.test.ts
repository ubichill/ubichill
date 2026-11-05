import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    CI_CREDENTIALS_PREFIX,
    type Credential,
    decodeCiCredentials,
    encodeCiCredentials,
    normalizeServer,
    removeCredential,
    resolveCredential,
    saveCredential,
} from './credentials.ts';

const credential = (server: string, environmentId = 'env-1'): Credential => ({
    server,
    account: 'youkan@ubichill.com',
    token: 'ubi_token',
    key: 'PKCS8',
    environmentId,
});
const tempPath = () => join(mkdtempSync(join(tmpdir(), 'ubichill-cred-')), 'credentials.json');

describe('CI 用の文字列', () => {
    it('作った文字列を読み戻せる（接頭辞付き）', () => {
        const text = encodeCiCredentials(credential('https://ubichill.com'));
        expect(text.startsWith(CI_CREDENTIALS_PREFIX)).toBe(true);
        expect(decodeCiCredentials(`  ${text}\n`)).toEqual(credential('https://ubichill.com'));
    });

    it('接頭辞が無い・壊れている・項目が足りない文字列は理由つきで失敗する（Secret の貼り間違いに気付ける）', () => {
        expect(() => decodeCiCredentials('ubi_xxx')).toThrow(/形式が違います/);
        expect(() => decodeCiCredentials(`${CI_CREDENTIALS_PREFIX}!!!`)).toThrow(/読めません/);
        const missing = `${CI_CREDENTIALS_PREFIX}${Buffer.from(JSON.stringify({ server: 'https://a' })).toString('base64url')}`;
        expect(() => decodeCiCredentials(missing)).toThrow(/読めません/);
    });
});

describe('手元の認証情報', () => {
    it('サーバーごとに保存し、指定が無ければ最後にログインしたサーバーを使う。ファイルは本人だけが読める（0600）', () => {
        const path = tempPath();
        saveCredential(credential('https://a.example'), path);
        saveCredential(credential('https://b.example', 'env-b'), path);
        expect(resolveCredential({ path, env: {} })?.server).toBe('https://b.example');
        expect(resolveCredential({ path, env: {}, server: 'a.example' })?.server).toBe('https://a.example');
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(JSON.parse(readFileSync(path, 'utf-8')).default).toBe('https://b.example');
    });

    it('消すと、既定のサーバーは残っている別のサーバーになる', () => {
        const path = tempPath();
        saveCredential(credential('https://a.example'), path);
        saveCredential(credential('https://b.example'), path);
        removeCredential('https://b.example', path);
        expect(resolveCredential({ path, env: {} })?.server).toBe('https://a.example');
        expect(resolveCredential({ path, env: {}, server: 'https://b.example' })).toBeUndefined();
    });

    it('env UBICHILL_CREDENTIALS があればそれを使い、--server と違えば失敗する（別のサーバーへ送らない）', () => {
        const env = { UBICHILL_CREDENTIALS: encodeCiCredentials(credential('https://ci.example')) };
        expect(resolveCredential({ env, path: tempPath() })?.server).toBe('https://ci.example');
        expect(() => resolveCredential({ env, path: tempPath(), server: 'https://other.example' })).toThrow(/違います/);
    });
});

describe('normalizeServer', () => {
    it('ホスト名だけなら https、パスや末尾の / は落としてオリジンにする', () => {
        expect(normalizeServer('ubichill.com')).toBe('https://ubichill.com');
        expect(normalizeServer('https://ubichill.com/')).toBe('https://ubichill.com');
        expect(normalizeServer('http://localhost:3001/api')).toBe('http://localhost:3001');
    });
});
