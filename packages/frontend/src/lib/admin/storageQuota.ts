import { formatBytes, WORLD_ASSET_QUOTA_PRESETS } from '@ubichill/shared';

/** 選べる容量（API で決まった値が選択肢に無ければ、それも並べる）。小さい順。 */
export function quotaChoices(current: number): Array<{ value: string; label: string }> {
    const values = WORLD_ASSET_QUOTA_PRESETS.includes(current)
        ? WORLD_ASSET_QUOTA_PRESETS
        : [...WORLD_ASSET_QUOTA_PRESETS, current].sort((a, b) => a - b);
    return values.map((bytes) => ({ value: String(bytes), label: formatBytes(bytes) }));
}
