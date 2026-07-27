/**
 * buildWorldLock（frontend アダプタ）— ワールド保存時に mod 完全性ロックを組み立てる。
 *
 * 収集・取得・構築の中核は @ubichill/loader。ここは baseUrl（MOD_BASE_URL）を注入するだけ。
 */
import { buildWorldLock as build, collectModIds, createHttpLockEntryGetter } from '@ubichill/loader';
import type { ModLock, WorldDefinition } from '@ubichill/shared';
import { MOD_BASE_URL } from './modLoader';

/** ワールド定義から mod 完全性ロックを構築する（HTTP 経由で各 mod の lock.json 断片を取得）。 */
export async function buildWorldLock(definition: WorldDefinition): Promise<ModLock> {
    const modIds = collectModIds(definition.spec.initialEntities);
    return build(modIds, createHttpLockEntryGetter(MOD_BASE_URL));
}
