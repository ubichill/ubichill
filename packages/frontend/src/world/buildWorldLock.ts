/**
 * buildWorldLock（frontend アダプタ）— ワールド保存時に mod 完全性ロックを組み立てる。
 *
 * 収集・取得・構築の中核は @ubichill/loader。ここは既定の取得元（baseUrl）を注入するだけ。
 * dependencies の解決（url個別ソース・version pin）は
 * `createDependencyAwareLockEntryGetter` に一本化（`installDependencies.ts` の CLI 側と共有）。
 */
import {
    buildWorldLock as build,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
} from '@ubichill/loader';
import { type ModLock, requiredLockModIds, unlockedModIds, type WorldDefinition } from '@ubichill/shared';

/**
 * ワールド定義から mod 完全性ロックを構築する（HTTP 経由で各 mod の lock.json 断片を取得）。
 * 固定できなかった mod を `unpinned` で返す。1 つでもあれば作者署名は無効になる（＝公開できない）ので、
 * 保存側はそのまま非公開で保存するかを確認する。
 */
export async function buildWorldLock(
    definition: WorldDefinition,
    baseUrl: string,
): Promise<{ lock: ModLock; unpinned: string[] }> {
    const defaultGetLockEntry = createHttpLockEntryGetter(baseUrl);
    const getLockEntry = createDependencyAwareLockEntryGetter(
        definition.spec.dependencies,
        defaultGetLockEntry,
        undefined,
        definition.spec.lock,
    );
    const lock = await build(requiredLockModIds(definition.spec), getLockEntry);
    return { lock, unpinned: unlockedModIds(definition.spec, lock) };
}
