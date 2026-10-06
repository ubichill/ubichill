/**
 * ワールドの署名が今の内容に対して有効かを調べる（`ubichill verify <world.yaml>`。Node 専用: fs 依存）。
 * 署名は `ubichill publish`（`ubichill login` / CI は `ubichill ci create` の公開環境）で付ける。
 * ここでは鍵を扱わない。作者アカウントが本当にその鍵の持ち主かは、配信先のサーバーが WebFinger で確かめる。
 */
import { existsSync, readFileSync } from 'node:fs';
import { verifyWorldSignature, type WorldDocument } from '@ubichill/shared';
import yaml from 'yaml';
import { webWorldCrypto } from './worldCrypto.ts';

const sigPathFor = (worldPath: string): string => worldPath.replace(/\.ya?ml$/i, '.sig.json');

function readWorldDocument(worldPath: string): WorldDocument {
    const lockPath = worldPath.replace(/\.ya?ml$/i, '.lock.json');
    return {
        definition: yaml.parse(readFileSync(worldPath, 'utf-8')) as unknown,
        lock: existsSync(lockPath) ? (JSON.parse(readFileSync(lockPath, 'utf-8')) as unknown) : null,
    };
}

/**
 * 使い方: `<world.yaml>`。兄弟の `.sig.json` が `<world>.yaml` と `.lock.json` の今の内容に対して有効かを調べる（CI 用）。
 * 無効・署名なし・作者アカウントなしなら `process.exitCode = 1`（作者の付かない署名は公開されないため不合格にする）。
 */
export async function runVerifyWorld(argv: string[]): Promise<void> {
    const worldPath = argv.find((a) => !a.startsWith('--'));
    if (!worldPath || !/\.ya?ml$/i.test(worldPath)) throw new Error('usage: ubichill verify <world.yaml>');
    const sigPath = sigPathFor(worldPath);
    const signature = existsSync(sigPath) ? (JSON.parse(readFileSync(sigPath, 'utf-8')) as unknown) : undefined;
    const verdict = await verifyWorldSignature(readWorldDocument(worldPath), signature, webWorldCrypto);
    if (verdict.status !== 'verified') {
        const detail = verdict.status === 'invalid' ? verdict.reason : '署名ファイルがありません';
        console.error(`❌ ${sigPath} は無効です (${detail})。\`ubichill publish\` で署名し直してください。`);
        process.exitCode = 1;
        return;
    }
    const author = (signature as { author?: unknown }).author;
    if (typeof author !== 'string') {
        console.error(
            `❌ ${sigPath} に作者アカウントがありません（作者の付かない署名は公開されません）。\`ubichill publish\` で署名し直してください。`,
        );
        process.exitCode = 1;
        return;
    }
    console.log(`✅ ${sigPath} は有効です（作者 @${author}、${verdict.worldId}）`);
}
