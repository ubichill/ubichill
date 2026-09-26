import { webWorldCrypto } from '@ubichill/loader';
import { signWorld, type WorldIdentity } from '@ubichill/shared';
import yaml from 'yaml';
import type { WorldSigner } from './signer';

export interface SignHostedWorldDeps {
    apiBase: string;
    fetch: typeof fetch;
}

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

/**
 * 本体に保存済みのワールドへ作者署名を付ける。
 *
 * 手元の編集内容ではなく、**サーバーが配信している値**（YAML と lock）に署名する。
 * 保存時にサーバーが metadata.name を採番したり lock を分離したりするため、
 * 手元の値に署名すると配信物と一致しない。
 */
export async function signHostedWorld(
    worldId: string,
    signer: WorldSigner,
    { apiBase, fetch }: SignHostedWorldDeps,
): Promise<WorldIdentity> {
    const base = `${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}`;
    const [yamlRes, lockRes] = await Promise.all([
        fetch(`${base}?format=yaml`, { headers: { Accept: 'application/yaml' }, cache: 'no-store' }),
        fetch(`${base}/lock`, { headers: { Accept: 'application/json' }, cache: 'no-store' }),
    ]);
    if (!yamlRes.ok) throw new Error(`ワールドを取得できません: ${await errorMessage(yamlRes)}`);
    if (!lockRes.ok && lockRes.status !== 404) throw new Error(`lock を取得できません: ${await errorMessage(lockRes)}`);

    const definition = yaml.parse(await yamlRes.text()) as unknown;
    const lock = lockRes.ok ? ((await lockRes.json()) as unknown) : null;
    const signature = await signWorld({ definition, lock }, signer.key, webWorldCrypto, { author: signer.author });

    const res = await fetch(`${base}/sig`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(signature),
    });
    if (!res.ok) throw new Error(`署名を保存できません: ${await errorMessage(res)}`);
    return ((await res.json()) as { identity: WorldIdentity }).identity;
}
