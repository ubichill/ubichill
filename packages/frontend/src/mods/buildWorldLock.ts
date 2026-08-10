/**
 * buildWorldLock（frontend アダプタ）— ワールド保存時に mod 完全性ロックを組み立てる。
 *
 * 収集・取得・構築の中核は @ubichill/loader。ここは baseUrl（MOD_BASE_URL）を注入するだけ。
 */
import {
    buildWorldLock as build,
    collectModIds,
    createHttpLockEntryGetter,
    type LockEntryGetter,
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

    // dependencies[].source.type === 'url' の mod だけ、そのURLから個別に取得し baseUrl を焼き込む
    // （packages/loader/src/genLock.ts の CLI 側ロジックと同じパターン）。
    const urlSourceByModId = new Map(
        (definition.spec.dependencies ?? [])
            .filter((d) => d.source.type === 'url' && d.source.url)
            .map((d) => [d.name, d.source.url as string]),
    );
    const getLockEntry: LockEntryGetter = async (modId) => {
        const modUrl = urlSourceByModId.get(modId);
        if (!modUrl) return defaultGetLockEntry(modId);
        const entry = await createHttpLockEntryGetter(modUrl)(modId);
        return entry ? { ...entry, baseUrl: modUrl } : null;
    };

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
