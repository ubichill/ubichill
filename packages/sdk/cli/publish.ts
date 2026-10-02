/**
 * `ubichill publish <world.yaml>`: mod の固定（install）・作者アカウント付きの署名・公開を一度に行う。
 *
 * - 本体へ公開（既定）: 初回は作成し、以後は同じワールドを更新する。対応は `<world>.ubichill.json` に記録する（秘密は含まない）。
 *   サーバーは metadata.name を自分の ID にして保存するので、サーバーが保存する値（prepare）に署名し、内容と署名を一緒に送る。
 * - 外部ホストへ公開（`--out=<dir>`）: 署名済みの world.yaml / .lock.json / .sig.json を出力する（GitHub Pages など）。
 * 署名には `ubichill login`（CI は UBICHILL_CREDENTIALS）の鍵と作者アカウントを使う。
 */
import { basename, join } from 'node:path';
import { signWorld, unpinnedModsOf, type WorldDocument, type WorldSigningKey } from '@ubichill/shared';
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

/** `<world>.ubichill.json`: 本体のどのワールドに公開したか（サーバーごと）。 */
interface PublishRecord {
    servers: Record<string, { worldId: string }>;
}

export const publishRecordPathFor = (worldPath: string) => worldPath.replace(/\.ya?ml$/i, '.ubichill.json');
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

/** 外部ホスト向け: 署名済みの 3 ファイルを書き出す。 */
async function publishToDirectory(deps: PublishDeps, options: PublishOptions & { outDir: string }): Promise<string> {
    const local = readLocal(deps, options.worldPath);
    const reason = unpublishableReason(local.doc);
    if (reason) throw new Error(`公開できません: ${reason}`);
    const signature = await signWorld(local.doc, deps.key, deps.crypto, { author: options.credential.account });
    const name = basename(options.worldPath);
    deps.fs.mkdir(options.outDir);
    const outWorld = join(options.outDir, name);
    deps.fs.writeText(outWorld, local.yamlText);
    if (local.lockText !== undefined) deps.fs.writeText(lockPathFor(outWorld), local.lockText);
    deps.fs.writeText(outWorld.replace(/\.ya?ml$/i, '.sig.json'), `${JSON.stringify(signature, null, 2)}\n`);
    deps.log(`🔏 ${outWorld} と .lock.json / .sig.json を書き出しました（作者 @${options.credential.account}）`);
    return outWorld;
}

/** 本体へ: 作成（初回）→ prepare → 署名 → 内容と署名を一緒に保存。 */
async function publishToServer(deps: PublishDeps, options: PublishOptions): Promise<string> {
    const local = readLocal(deps, options.worldPath);
    const reason = unpublishableReason(local.doc);
    if (reason) throw new Error(`公開できません: ${reason}`);
    const server = options.credential.server;
    const recordPath = publishRecordPathFor(options.worldPath);
    const recordText = deps.fs.readText(recordPath);
    const record: PublishRecord = recordText ? (JSON.parse(recordText) as PublishRecord) : { servers: {} };
    const body = { yaml: local.yamlText, lock: local.lock ?? undefined };

    const create = async (): Promise<string> => {
        const created = await deps.request('POST', '/api/v1/worlds/yaml', body);
        if (created.status !== 201 || typeof created.body.id !== 'string') throw errorOf(created, 'ワールドを作成できませんでした');
        const next: PublishRecord = { servers: { ...record.servers, [server]: { worldId: created.body.id } } };
        deps.fs.writeText(recordPath, `${JSON.stringify(next, null, 2)}\n`);
        deps.log(`🆕 ${server} にワールド ${created.body.id} を作成しました（${recordPath} に記録。コミットして共有できます）`);
        return created.body.id;
    };

    const known = record.servers[server]?.worldId;
    const prepareFor = async (worldId: string) => deps.request('POST', `/api/v1/worlds/${encodeURIComponent(worldId)}/prepare`, body);
    const first = known ? await prepareFor(known) : undefined;
    // 記録したワールドが消されていたら作り直す（別のワールドとして公開される）
    const worldId = known && first?.status !== 404 ? known : await create();
    const prepared = first && worldId === known ? first : await prepareFor(worldId);
    if (prepared.status !== 200) throw errorOf(prepared, '公開の準備に失敗しました');

    const signature = await signWorld(prepared.body as unknown as WorldDocument, deps.key, deps.crypto, {
        author: options.credential.account,
    });
    const saved = await deps.request('PUT', `/api/v1/worlds/${encodeURIComponent(worldId)}/yaml`, { ...body, signature });
    if (saved.status !== 200) throw errorOf(saved, '公開できませんでした');
    const url = `${server}/world/${worldId}`;
    deps.log(`✅ 公開しました: ${url}（作者 @${options.credential.account}）`);
    return url;
}

export function publish(deps: PublishDeps, options: PublishOptions): Promise<string> {
    return options.outDir
        ? publishToDirectory(deps, { ...options, outDir: options.outDir })
        : publishToServer(deps, options);
}
