/**
 * 設定の「ストレージ」の見せ方（API を呼ばない純粋な部分。呼ぶのは storageApi.ts）。
 */
import type { StorageOverview, StoredFile } from '@ubichill/shared';

/** 使っている割合（0〜1）。容量を下げて越えていても 1 で止める。 */
export function usageRatio(usage: { bytes: number }, quotaBytes: number): number {
    if (quotaBytes <= 0) return 1;
    return Math.min(1, Math.max(0, usage.bytes / quotaBytes));
}

/** メーターの色。9 割を越えたら注意、いっぱい（新しく置けない）なら警告。 */
export function usageTone(usage: { bytes: number }, quotaBytes: number): 'normal' | 'near' | 'full' {
    if (usage.bytes >= quotaBytes) return 'full';
    return usageRatio(usage, quotaBytes) >= 0.9 ? 'near' : 'normal';
}

const SHOWN_WORLDS = 3;

/** 消す前に確かめる文。自分のワールドで使っていなければ null（すぐ消す）。 */
export function deleteConfirmation(file: StoredFile): string | null {
    if (file.usedBy.length === 0) return null;
    const names = file.usedBy
        .slice(0, SHOWN_WORLDS)
        .map((use) => `「${use.worldName}」`)
        .join('');
    const more = file.usedBy.length > SHOWN_WORLDS ? `ほか ${file.usedBy.length - SHOWN_WORLDS} 個のワールド` : '';
    return `${names}${more}で使っています。消すと、そのワールドでこの画像が出なくなります。消しますか？`;
}

/** 消した後の一覧と使っている量。 */
export function withoutFile(overview: StorageOverview, file: StoredFile): StorageOverview {
    const files = overview.files.filter((f) => !(f.kind === file.kind && f.id === file.id));
    if (files.length === overview.files.length) return overview;
    return {
        ...overview,
        files,
        usage: { bytes: Math.max(0, overview.usage.bytes - file.bytes), count: files.length },
    };
}
