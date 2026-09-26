/**
 * ワールド署名の CLI 実装（Node 専用: fs 依存）。入口は `packages/sdk/cli`（`ubichill sign` / `ubichill keygen`）。
 *
 * 署名対象は `<world>.yaml` と兄弟 `<world>.lock.json` の生の値。lock を再生成
 * （`ubichill install`）したら署名は無効になるので、その後に必ず `sign` し直す。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { signWorld, verifyWorldSignature, type WorldDocument, worldIdOf } from '@ubichill/shared';
import yaml from 'yaml';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from './worldCrypto.ts';

const SIGNING_KEY_ENV = 'UBICHILL_SIGNING_KEY';

function argValue(argv: string[], name: string): string | undefined {
    return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function readWorldDocument(worldPath: string): WorldDocument {
    const lockPath = worldPath.replace(/\.ya?ml$/i, '.lock.json');
    return {
        definition: yaml.parse(readFileSync(worldPath, 'utf-8')) as unknown,
        lock: existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, 'utf-8')) as unknown) : null,
    };
}

/**
 * 使い方: `<world.yaml> [--key-file=<path>] [--out=<path>] [--check]`。
 * 鍵は `--key-file` か env `UBICHILL_SIGNING_KEY`（PKCS8 base64）。
 * `--check`: 書き込まず既存署名が現在の world + lock に対して有効か検証する（CI 用）。
 */
export async function runSign(argv: string[]): Promise<void> {
    const worldPath = argv.find((a) => !a.startsWith('--'));
    if (!worldPath || !/\.ya?ml$/i.test(worldPath)) {
        throw new Error('usage: ubichill sign <world.yaml> [--key-file=<path>] [--out=<path>] [--check]');
    }
    const outPath = argValue(argv, 'out') ?? worldPath.replace(/\.ya?ml$/i, '.sig.json');
    const doc = readWorldDocument(worldPath);

    if (argv.includes('--check')) {
        const current = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf-8')) as unknown) : undefined;
        const verdict = await verifyWorldSignature(doc, current, webWorldCrypto);
        if (verdict.status !== 'verified') {
            const detail = verdict.status === 'invalid' ? verdict.reason : '署名ファイルがありません';
            console.error(
                `❌ ${outPath} は無効です (${detail})。\`ubichill sign ${worldPath}\` で署名し直してください。`,
            );
            process.exitCode = 1;
            return;
        }
        console.log(`✅ ${outPath} は有効です (${verdict.worldId})`);
        return;
    }

    const keyFile = argValue(argv, 'key-file');
    const pkcs8 = keyFile ? readFileSync(keyFile, 'utf-8') : process.env[SIGNING_KEY_ENV];
    if (!pkcs8) throw new Error(`署名鍵がありません。--key-file=<path> か env ${SIGNING_KEY_ENV} を指定してください`);
    const key = await importSigningKey(pkcs8);

    const sig = await signWorld(doc, key, webWorldCrypto);
    writeFileSync(outPath, `${JSON.stringify(sig, null, 2)}\n`, 'utf-8');
    console.log(`🔏 ${outPath} (${worldIdOf(sig.publicKey, sig.name)})`);
}

/**
 * 使い方: `[--out=<path>]`（既定 `ubichill-signing.key`）。既存ファイルは上書きしない
 * （鍵を失うと以後の署名が別作者扱いになるため）。
 */
export async function runKeygen(argv: string[]): Promise<void> {
    const outPath = argValue(argv, 'out') ?? 'ubichill-signing.key';
    if (existsSync(outPath)) throw new Error(`${outPath} は既に存在します（上書きしません）`);
    const pkcs8 = await generateSigningKeyPkcs8();
    writeFileSync(outPath, `${pkcs8}\n`, { encoding: 'utf-8', mode: 0o600 });
    const { publicKey } = await importSigningKey(pkcs8);
    console.log(`🔑 秘密鍵を ${outPath} に書き出しました。コミットせず安全に保管してください。`);
    console.log(`   公開鍵: ${publicKey}`);
}
