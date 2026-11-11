import { lockedMods, type ModLock } from '@ubichill/shared';

/** package 単位で失敗を分離し、動く部品と失敗した mod の名前を両方返す。 */
export async function loadEditorPackages<T>(
    lock: ModLock,
    unpinned: string[],
    load: (entry: ReturnType<typeof lockedMods>[string]) => Promise<T>,
) {
    const entries = Object.values(lockedMods(lock));
    const results = await Promise.allSettled(entries.map(load));
    return {
        packages: results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
        failures: [
            ...unpinned,
            ...results.flatMap((result, index) =>
                result.status === 'rejected'
                    ? [
                          `${entries[index].id}: ${result.reason instanceof Error ? result.reason.message : '取得できません'}`,
                      ]
                    : [],
            ),
        ],
    };
}
