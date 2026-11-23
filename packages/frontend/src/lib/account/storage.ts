/**
 * 設定の「ストレージ」の見せ方（API を呼ばない純粋な部分。呼ぶのは storageApi.ts）。
 */
import type { StorageOverview, StoredFile, StoredFilePage, StoredFileRef } from '@ubichill/shared';

export const fileKey = (file: StoredFileRef): string => `${file.kind}:${file.id}`;

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

/**
 * 消す前に確かめる文。自分のワールドで使っているものが無ければ null（すぐ消す）。
 * ほかの人のワールドで使っているかは数えない（重い）ので、一言だけ添える。
 */
export function deleteConfirmation(files: readonly StoredFile[]): string | null {
    const used = files.filter((file) => file.usedBy.length > 0);
    if (used.length === 0) return null;
    const worlds = [
        ...new Map(used.flatMap((file) => file.usedBy.map((use) => [use.worldId, use.worldName]))).values(),
    ];
    const names = worlds
        .slice(0, SHOWN_WORLDS)
        .map((name) => `「${name}」`)
        .join('');
    const more = worlds.length > SHOWN_WORLDS ? `ほか ${worlds.length - SHOWN_WORLDS} 個のワールド` : '';
    const subject = files.length > 1 ? `選んだ ${files.length} 個のうち ${used.length} 個を` : '';
    return `${subject}${names}${more}で使っています。消すと、そこで画像が出なくなります（このサーバーのほかの人のワールドも同じ）。消しますか？`;
}

/** 続きのページを足す（読み直しで重なったものは足さない）。 */
export function withPage(overview: StorageOverview, page: StoredFilePage): StorageOverview {
    const seen = new Set(overview.files.items.map(fileKey));
    return {
        ...overview,
        files: {
            items: [...overview.files.items, ...page.items.filter((f) => !seen.has(fileKey(f)))],
            next: page.next,
        },
    };
}

/** 消せたものを一覧と使っている量から除く（一覧に無いものは数えない）。 */
export function withoutFiles(overview: StorageOverview, removed: readonly StoredFileRef[]): StorageOverview {
    const gone = new Set(removed.map(fileKey));
    const dropped = overview.files.items.filter((f) => gone.has(fileKey(f)));
    if (dropped.length === 0) return overview;
    return {
        ...overview,
        files: { ...overview.files, items: overview.files.items.filter((f) => !gone.has(fileKey(f))) },
        usage: {
            bytes: Math.max(0, overview.usage.bytes - dropped.reduce((sum, f) => sum + f.bytes, 0)),
            count: Math.max(0, overview.usage.count - dropped.length),
        },
    };
}

/** まとめて消すときに分ける（1 回で消せる数まで）。 */
export function chunksOf<T>(items: readonly T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_, n) => items.slice(n * size, (n + 1) * size));
}

/**
 * 続きを読む状態。見えたら自動で読むのは、前の読み込みが成功している間だけ（失敗したら「もっと見る」を押すまで止める。
 * 止めないと、読み込みが終わるたびにまた「見えた」と知らされて、失敗を繰り返し続ける）。
 */
export interface MoreLoadState {
    loading: boolean;
    auto: boolean;
}

export const INITIAL_MORE_LOAD: MoreLoadState = { loading: false, auto: true };

export function moreLoadAfter(state: MoreLoadState, event: 'start' | 'success' | 'failure'): MoreLoadState {
    if (event === 'start') return { ...state, loading: true };
    return { loading: false, auto: event === 'success' };
}

/** 見えたときに自動で読んでよいか。 */
export const autoLoads = (state: MoreLoadState, next: string | null): boolean => !!next && state.auto && !state.loading;

/**
 * まとめて消す（1 回で消せる数ずつ順に送る）。途中で失敗したら、そこまでに送れた分と、失敗の文を返す
 * （送れた分は一覧と量から除く）。
 */
export async function deleteInChunks<T>(
    files: readonly T[],
    size: number,
    send: (chunk: T[]) => Promise<void>,
): Promise<{ done: T[]; error: string | null }> {
    return chunksOf(files, size).reduce<Promise<{ done: T[]; error: string | null }>>(
        async (previous, chunk) => {
            const sofar = await previous;
            if (sofar.error) return sofar;
            return send(chunk).then(
                () => ({ done: [...sofar.done, ...chunk], error: null }),
                (e: unknown) => ({ done: sofar.done, error: e instanceof Error ? e.message : '消せませんでした' }),
            );
        },
        Promise.resolve({ done: [], error: null }),
    );
}
