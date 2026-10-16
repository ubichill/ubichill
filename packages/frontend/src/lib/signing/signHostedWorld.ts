import type { ModLock, WorldIdentity } from '@ubichill/shared';
import { errorMessage, type SaveWorldDeps, saveWorldBundle } from './saveHostedWorld';
import type { WorldSigner } from './signer';

/**
 * 本体で公開中の版（YAML と lock）に署名し直す（鍵を取り消したあと・署名の形式が古いときなど）。
 * 取るのは、ほかのサーバーが読むのと同じ配信の道筋（`url`、`/api/v1/authors/<ID>/worlds/<名前>.yaml` と兄弟の `.lock.json`）。
 * 署名する値は配信している生の値そのもの。新しい内容を送るのと同じ {@link saveWorldBundle} を使う。
 */
export async function signHostedWorld(
    world: { id: string; url: string },
    signer: WorldSigner,
    deps: SaveWorldDeps,
): Promise<WorldIdentity> {
    const { fetch } = deps;
    const [yamlRes, lockRes] = await Promise.all([
        fetch(world.url, { cache: 'no-store' }),
        fetch(world.url.replace(/\.ya?ml$/i, '.lock.json'), { cache: 'no-store' }),
    ]);
    if (!yamlRes.ok) throw new Error(`ワールドを取得できません: ${await errorMessage(yamlRes)}`);
    if (!lockRes.ok && lockRes.status !== 404) throw new Error(`lock を取得できません: ${await errorMessage(lockRes)}`);
    const lock = lockRes.ok ? ((await lockRes.json()) as ModLock) : null;
    const saved = await saveWorldBundle({ yaml: await yamlRes.text(), lock, worldId: world.id }, signer, deps);
    return saved.identity;
}
