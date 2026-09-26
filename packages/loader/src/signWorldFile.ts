/**
 * ワールド署名の CLI 実装（Node 専用: fs 依存）。入口は `packages/sdk/cli`（`ubichill sign` / `ubichill keygen`）。
 *
 * 署名対象は `<world>.yaml` と兄弟 `<world>.lock.json` の生の値。lock を再生成
 * （`ubichill install`）したら署名は無効になるので、その後に必ず `sign` し直す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    formatAuthorAccount,
    parseAuthorAccount,
    signWorld,
    verifyWorldSignature,
    type WorldDocument,
    WorldSignatureSchema,
    worldIdOf,
} from '@ubichill/shared';
import yaml from 'yaml';
import { generateSigningKeyPkcs8, importSigningKey, webWorldCrypto } from './worldCrypto.ts';

const SIGNING_KEY_ENV = 'UBICHILL_SIGNING_KEY';
const SIGNING_KEY_FILE_ENV = 'UBICHILL_SIGNING_KEY_FILE';
const AUTHOR_ENV = 'UBICHILL_AUTHOR';

/** 既定の鍵ファイル。リポジトリの外（ホーム）に置き、誤コミットを防ぐ。 */
export const defaultSigningKeyFile = (): string => join(homedir(), '.config', 'ubichill', 'signing.key');

/** 鍵の探索順: `--key-file` > env UBICHILL_SIGNING_KEY > env UBICHILL_SIGNING_KEY_FILE > 既定ファイル。 */
function resolveSigningKeyPkcs8(argv: string[]): string | undefined {
    const keyFile = argValue(argv, 'key-file');
    if (keyFile) return readFileSync(keyFile, 'utf-8');
    if (process.env[SIGNING_KEY_ENV]) return process.env[SIGNING_KEY_ENV];
    const envFile = process.env[SIGNING_KEY_FILE_ENV];
    if (envFile) return readFileSync(envFile, 'utf-8');
    return existsSync(defaultSigningKeyFile()) ? readFileSync(defaultSigningKeyFile(), 'utf-8') : undefined;
}

/**
 * 署名に載せる作者アカウント（`--author=handle@domain` か env UBICHILL_AUTHOR）。
 * ホストに登録した公開鍵と同じ鍵で署名したときだけ、検証側で作者として表示される。
 */
function resolveAuthor(argv: string[]): string | undefined {
    const raw = argValue(argv, 'author') ?? process.env[AUTHOR_ENV];
    if (!raw) return undefined;
    const parsed = parseAuthorAccount(raw);
    if (!parsed) throw new Error(`作者アカウントの形式が不正です（handle@domain）: ${raw}`);
    return formatAuthorAccount(parsed);
}

const sigPathFor = (worldPath: string): string => worldPath.replace(/\.ya?ml$/i, '.sig.json');

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
 * 使い方: `<world.yaml> [--key-file=<path>] [--author=handle@domain] [--out=<path>] [--check]`。
 * 鍵の探索順は {@link resolveSigningKeyPkcs8}（PKCS8 base64）。
 * `--check`: 書き込まず既存署名が現在の world + lock に対して有効か検証する（CI 用）。
 */
export async function runSign(argv: string[]): Promise<void> {
    const worldPath = argv.find((a) => !a.startsWith('--'));
    if (!worldPath || !/\.ya?ml$/i.test(worldPath)) {
        throw new Error(
            'usage: ubichill sign <world.yaml> [--key-file=<path>] [--author=handle@domain] [--out=<path>] [--check]',
        );
    }
    const outPath = argValue(argv, 'out') ?? sigPathFor(worldPath);
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

    const pkcs8 = resolveSigningKeyPkcs8(argv);
    if (!pkcs8) {
        throw new Error(
            `署名鍵がありません。\`ubichill keygen\` で ${defaultSigningKeyFile()} に作るか、--key-file=<path> / env ${SIGNING_KEY_ENV} を指定してください`,
        );
    }
    const key = await importSigningKey(pkcs8);

    const sig = await signWorld(doc, key, webWorldCrypto, { author: resolveAuthor(argv) });
    writeFileSync(outPath, `${JSON.stringify(sig, null, 2)}\n`, 'utf-8');
    console.log(`🔏 ${outPath} (${worldIdOf(sig.publicKey, sig.name)})`);
}

/**
 * `ubichill install` の最後に呼ぶ。鍵があれば兄弟 lock と合わせて署名し、無ければ
 * 「署名なし＝ホストの一覧に公開されない」ことを警告する（署名し忘れで黙って非公開にならないように）。
 * 別の鍵で署名済みなら上書きしない（worldId が変わる＝別作者扱いになるため、明示の `sign` を求める）。
 */
export async function signAfterInstall(worldPath: string, argv: string[]): Promise<void> {
    const pkcs8 = resolveSigningKeyPkcs8(argv);
    if (!pkcs8) {
        console.warn(
            `⚠ 署名鍵が無いため ${worldPath} は署名なしです。ホストの一覧に公開されず、入室時に警告が出ます。` +
                `\`ubichill keygen\` で鍵を作ると以後 install 時に自動で署名します。`,
        );
        return;
    }
    const key = await importSigningKey(pkcs8);
    const sigPath = sigPathFor(worldPath);
    const existing = existsSync(sigPath)
        ? WorldSignatureSchema.safeParse(JSON.parse(readFileSync(sigPath, 'utf-8')) as unknown)
        : undefined;
    if (existing?.success && existing.data.publicKey !== key.publicKey) {
        console.warn(
            `⚠ ${sigPath} は別の鍵で署名されているため自動署名しません（上書きすると別作者扱いになります）。` +
                `意図的に署名し直すなら \`ubichill sign ${worldPath} --key-file=<path>\` を実行してください。`,
        );
        return;
    }
    const sig = await signWorld(readWorldDocument(worldPath), key, webWorldCrypto, { author: resolveAuthor(argv) });
    writeFileSync(sigPath, `${JSON.stringify(sig, null, 2)}\n`, 'utf-8');
    console.log(`🔏 ${sigPath} (${worldIdOf(sig.publicKey, sig.name)})`);
}

/**
 * 使い方: `[--out=<path>]`（既定 `~/.config/ubichill/signing.key`）。既存ファイルは上書きしない
 * （鍵を失うと以後の署名が別作者扱いになるため）。
 */
export async function runKeygen(argv: string[]): Promise<void> {
    const outPath = argValue(argv, 'out') ?? defaultSigningKeyFile();
    if (existsSync(outPath)) throw new Error(`${outPath} は既に存在します（上書きしません）`);
    mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
    const pkcs8 = await generateSigningKeyPkcs8();
    writeFileSync(outPath, `${pkcs8}\n`, { encoding: 'utf-8', mode: 0o600 });
    const { publicKey } = await importSigningKey(pkcs8);
    console.log(`🔑 秘密鍵を ${outPath} に書き出しました。コミットせず、別の場所にもバックアップしてください。`);
    console.log('   ブラウザ（プロフィールの「作者署名の鍵」）でこのファイルを読み込むと同じ作者として署名できます。');
    console.log(`   公開鍵: ${publicKey}`);
}
