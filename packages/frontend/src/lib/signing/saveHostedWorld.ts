import { webWorldCrypto } from '@ubichill/loader';
import { type ModLock, signWorld, type WorldIdentity } from '@ubichill/shared';
import yaml from 'yaml';
import type { WorldSigner } from './signer';

export interface WorldSaveBody {
    yaml: string;
    lock: ModLock | null;
    /** 編集中のワールド。metadata.name が自分の別のワールドと同じなら、上書きせずサーバーが断る。 */
    worldId?: string;
}

export interface SaveWorldDeps {
    apiBase: string;
    /** 呼び出し側は `window.fetch` をそのまま渡してよい（ここでは `deps.fetch()` の形で呼ばない）。 */
    fetch: typeof fetch;
}

/** published = 署名付きで公開、draft = 公開中の版は残して下書きに保存、unsigned = 署名なしで保存（公開されない）。 */
export interface SavedWorld {
    id: string;
    saved: 'published' | 'draft' | 'unsigned';
    identity: WorldIdentity;
}

/** ブラウザの fetch を this に依存せず渡すための既定値。 */
export const browserFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

export async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

/**
 * ワールドを本体に保存する（外部に置くワールドと同じ「定義・lock・署名」の組をそのまま送る。サーバーは中身を書き換えない）。
 * 作者 + metadata.name で同じワールドかが決まるので、新規も更新も同じ呼び出しになる。
 * 署名する値は送る値そのもの（YAML を読んだ定義と lock）。鍵が無ければ署名なしで送り、公開中のワールドなら下書きになる。
 */
export async function saveWorldBundle(
    body: WorldSaveBody,
    signer: WorldSigner | null,
    { apiBase, fetch }: SaveWorldDeps,
): Promise<SavedWorld> {
    const signature = signer
        ? await signWorld(
              { definition: yaml.parse(body.yaml) as unknown, lock: body.lock },
              signer.key,
              webWorldCrypto,
              {
                  author: signer.author,
              },
          )
        : undefined;
    const res = await fetch(`${apiBase}/api/v1/worlds`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(signature ? { ...body, signature } : body),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as SavedWorld;
}
