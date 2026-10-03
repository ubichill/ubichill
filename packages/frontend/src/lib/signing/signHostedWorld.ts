import type { ModLock, WorldIdentity } from '@ubichill/shared';
import { errorMessage, type SaveWorldDeps, saveWorldBundle } from './saveHostedWorld';
import type { WorldSigner } from './signer';

/**
 * 本体で公開中の版（YAML と lock）に署名し直す（鍵を取り消したあとなど）。
 * 新しい内容を送るのと同じ {@link saveWorldBundle} を使う（署名し直しのための別の入口は作らない）。
 */
export async function signHostedWorld(
    worldId: string,
    signer: WorldSigner,
    deps: SaveWorldDeps,
): Promise<WorldIdentity> {
    const { apiBase, fetch } = deps;
    const base = `${apiBase}/api/v1/worlds/${encodeURIComponent(worldId)}`;
    const [yamlRes, lockRes] = await Promise.all([
        fetch(`${base}.yaml`, { cache: 'no-store' }),
        fetch(`${base}.lock.json`, { cache: 'no-store' }),
    ]);
    if (!yamlRes.ok) throw new Error(`ワールドを取得できません: ${await errorMessage(yamlRes)}`);
    if (!lockRes.ok && lockRes.status !== 404) throw new Error(`lock を取得できません: ${await errorMessage(lockRes)}`);
    const lock = lockRes.ok ? ((await lockRes.json()) as ModLock) : null;
    const saved = await saveWorldBundle({ yaml: await yamlRes.text(), lock, worldId }, signer, deps);
    return saved.identity;
}
