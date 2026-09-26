import { webWorldCrypto } from '@ubichill/loader';
import { type ModLock, signWorld } from '@ubichill/shared';
import type { WorldSigner } from './signer';
import { type SignHostedWorldDeps, signHostedWorld } from './signHostedWorld';

export interface WorldSaveBody {
    yaml: string;
    lock: ModLock;
}

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

/**
 * 既存ワールドを更新する。鍵があれば「サーバーが保存する値」を先に受け取って署名し、
 * 内容と署名を 1 回の PUT で送る（署名できなければ何も保存されない＝黙って未署名にならない）。
 * 鍵が無ければ未署名（非公開）での保存を明示して送る。呼び出し側で事前に確認を取ること。
 */
export async function updateHostedWorld(
    worldId: string,
    body: WorldSaveBody,
    signer: WorldSigner | null,
    { apiBase, fetch }: SignHostedWorldDeps,
): Promise<void> {
    const base = `${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}`;
    const json = { 'Content-Type': 'application/json' };

    const signature = signer
        ? await (async () => {
              const res = await fetch(`${base}/prepare`, {
                  method: 'POST',
                  headers: json,
                  credentials: 'include',
                  body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error(await errorMessage(res));
              const prepared = (await res.json()) as { definition: unknown; lock: unknown };
              return signWorld(prepared, signer.key, webWorldCrypto, { author: signer.author });
          })()
        : undefined;

    const res = await fetch(`${base}/yaml`, {
        method: 'PUT',
        headers: json,
        credentials: 'include',
        body: JSON.stringify(signature ? { ...body, signature } : { ...body, allowUnsigned: true }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
}

/**
 * 新規ワールドを作成し、鍵があれば続けて署名する。ID はサーバーが採番するため作成と署名は
 * 2 段階になるが、署名前のワールドは非公開なので途中で失敗しても未検証ワールドは公開されない。
 */
export async function createHostedWorld(
    body: WorldSaveBody,
    signer: WorldSigner | null,
    deps: SignHostedWorldDeps,
): Promise<{ id: string; signError?: string }> {
    const res = await deps.fetch(`${deps.apiBase}/api/v1/worlds/yaml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const { id } = (await res.json()) as { id: string };
    if (!signer) return { id };
    try {
        await signHostedWorld(id, signer, deps);
        return { id };
    } catch (e) {
        return { id, signError: e instanceof Error ? e.message : String(e) };
    }
}
