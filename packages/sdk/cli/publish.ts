/**
 * `ubichill publish <world.yaml>`: mod の固定（install）・作者アカウント付きの署名・公開を一度に行う。
 *
 * 本体へ送るのも外部ホストへ置くのも、同じ「world.yaml・lock・署名」の組（サーバーは中身を書き換えない）。
 * - 本体へ公開（既定）: 組を PUT /api/v1/worlds で送る。作者 + metadata.name で同じワールドかが決まるので、
 *   初回の作成と以後の更新は同じ呼び出し（手元に対応を記録しない）。共有 URL は `/@ID/metadata.name`。
 * - 外部ホストへ公開（`--out=<dir>`）: 組を world.yaml / .lock.json / .sig.json として書き出す（GitHub Pages など）。
 * 署名には `ubichill login`（CI は UBICHILL_CREDENTIALS）の鍵と作者アカウントを使う。
 */
import { basename, join } from 'node:path';
import { signWorld, unpinnedModsOf, type WorldDocument, type WorldSigningKey, worldShareUrl } from '@ubichill/shared';
import type { Credential } from './credentials.ts';

export interface PublishFs {
    readText: (path: string) => string | undefined;
    writeText: (path: string, text: string) => void;
    mkdir: (path: string) => void;
}

export interface PublishDeps {
    fs: PublishFs;
    /** 認証付きで本体の API を呼ぶ。 */
    request: (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<{ status: number; body: Record<string, unknown> }>;
    key: WorldSigningKey;
    crypto: Parameters<typeof signWorld>[2];
    parseYaml: (text: string) => unknown;
    log: (message: string) => void;
}

export interface PublishOptions {
    worldPath: string;
    credential: Credential;
    /** 外部ホスト向けに書き出す先（指定が無ければ本体へ公開）。 */
    outDir?: string;
}

const lockPathFor = (worldPath: string) => worldPath.replace(/\.ya?ml$/i, '.lock.json');

function errorOf(res: { status: number; body: Record<string, unknown> }, fallback: string): Error {
    return new Error(typeof res.body.error === 'string' ? res.body.error : `${fallback}（HTTP ${res.status}）`);
}

/** 署名できない理由（無ければ null）。lock に固定されていない mod がある署名は無効になるので、送る前に止める。 */
export function unpublishableReason(doc: WorldDocument): string | null {
    const unpinned = unpinnedModsOf(doc);
    if (unpinned === null) return 'ワールド定義を解釈できないため mod の固定を確認できません';
    if (unpinned.length > 0) return `lock に固定されていない mod があります: ${unpinned.join(', ')}`;
    return null;
}

function readLocal(deps: PublishDeps, worldPath: string) {
    const yamlText = deps.fs.readText(worldPath);
    if (yamlText === undefined) throw new Error(`${worldPath} が見つかりません`);
    const lockText = deps.fs.readText(lockPathFor(worldPath));
    const lock = lockText === undefined ? null : (JSON.parse(lockText) as unknown);
    return { yamlText, lockText, lock, doc: { definition: deps.parseYaml(yamlText), lock } as WorldDocument };
}

/** 固定と作者付きの署名を済ませた組。 */
async function signedBundle(deps: PublishDeps, options: PublishOptions) {
    const local = readLocal(deps, options.worldPath);
    const reason = unpublishableReason(local.doc);
    if (reason) throw new Error(`公開できません: ${reason}`);
    const signature = await signWorld(local.doc, deps.key, deps.crypto, { author: options.credential.account });
    return { ...local, signature };
}

/** 外部ホスト向け: 署名済みの 3 ファイルを書き出す。 */
async function publishToDirectory(deps: PublishDeps, options: PublishOptions & { outDir: string }): Promise<string> {
    const bundle = await signedBundle(deps, options);
    const name = basename(options.worldPath);
    deps.fs.mkdir(options.outDir);
    const outWorld = join(options.outDir, name);
    deps.fs.writeText(outWorld, bundle.yamlText);
    if (bundle.lockText !== undefined) deps.fs.writeText(lockPathFor(outWorld), bundle.lockText);
    deps.fs.writeText(outWorld.replace(/\.ya?ml$/i, '.sig.json'), `${JSON.stringify(bundle.signature, null, 2)}\n`);
    deps.log(`🔏 ${outWorld} と .lock.json / .sig.json を書き出しました（作者 @${options.credential.account}）`);
    return outWorld;
}

/** 本体へ: 同じ組をそのまま送る。 */
async function publishToServer(deps: PublishDeps, options: PublishOptions): Promise<string> {
    const bundle = await signedBundle(deps, options);
    const saved = await deps.request('PUT', '/api/v1/worlds', {
        yaml: bundle.yamlText,
        lock: bundle.lock,
        signature: bundle.signature,
    });
    if (saved.status !== 200 || typeof saved.body.url !== 'string') throw errorOf(saved, '公開できませんでした');
    // 共有 URL（/@ID/名前）。名前は world.yaml の metadata.name
    const url = worldShareUrl(saved.body.url);
    deps.log(`✅ 公開しました: ${url}（作者 @${options.credential.account}）`);
    return url;
}

export function publish(deps: PublishDeps, options: PublishOptions): Promise<string> {
    return options.outDir
        ? publishToDirectory(deps, { ...options, outDir: options.outDir })
        : publishToServer(deps, options);
}
