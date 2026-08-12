/**
 * buildWorldLock（frontend アダプタ）— ワールド保存時に mod 完全性ロックを組み立てる。
 *
 * 収集・取得・構築の中核は @ubichill/loader。ここは baseUrl（MOD_BASE_URL）を注入するだけ。
 * dependencies の解決（url個別ソース・version pin）は
 * `createDependencyAwareLockEntryGetter` に一本化（`installDependencies.ts` の CLI 側と共有）。
 */
import {
    buildWorldLock as build,
    collectModIds,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
} from '@ubichill/loader';
import type { ModLock, WorldDefinition } from '@ubichill/shared';
import { MOD_BASE_URL } from './modLoader';

/**
 * ワールド定義から mod 完全性ロックを構築する（HTTP 経由で各 mod の lock.json 断片を取得）。
 * lock 化できなかった mod があれば警告する（＝外部公開時にその mod は lock-missing 拒否になる）。
 * ローカル用途では寛容に読めるためブロックはしない。
 */
export async function buildWorldLock(definition: WorldDefinition): Promise<ModLock> {
    const modIds = collectModIds(definition.spec.initialEntities);
    const defaultGetLockEntry = createHttpLockEntryGetter(MOD_BASE_URL);
    const getLockEntry = createDependencyAwareLockEntryGetter(definition.spec.dependencies, defaultGetLockEntry);

    const lock = await build(modIds, getLockEntry);
    const missing = modIds.filter((id) => !(id in lock.mods));
    if (missing.length > 0) {
        console.warn(
            `[buildWorldLock] lock 断片を取得できず lock 化できない mod: ${missing.join(', ')}` +
                `（外部公開時はこの mod がロード拒否される）`,
        );
    }
    return lock;
}
