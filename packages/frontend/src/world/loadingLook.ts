/** ロード画面に出すワールドの見た目。 */
export interface LoadingLook {
    displayName?: string;
    thumbnail?: string;
}

const text = (value: string | undefined): string | undefined => value?.trim() || undefined;

/**
 * 前の画面から渡された見た目を先に使い（すぐ出せる）、足りない分は部屋を引いた結果で埋める。
 * 共有の URL から直接入ったときは渡されたものが無いので、部屋を引いた時点で出る。
 */
export function loadingLook(passed: LoadingLook | undefined, fetched: LoadingLook | null): LoadingLook {
    return {
        displayName: text(passed?.displayName) ?? text(fetched?.displayName),
        thumbnail: text(passed?.thumbnail) ?? text(fetched?.thumbnail),
    };
}
