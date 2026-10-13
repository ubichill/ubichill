/**
 * フロントと backend の版のずれの検知（純粋な判定と、確かめる手順）。
 *
 * 開いたままのタブは古いフロントのまま動き続ける。版がずれたら読み込み直して、フロントと backend が同じ版で動くようにする。
 * これを前提に、Host の内部の API（フロント ⇔ backend）は互換を残さずに変えられる（docs/PROTOCOLS.md）。
 */

const UNKNOWN = 'unknown';

/** フロントの版と backend の版がずれているか。どちらかが分からない（開発・取得失敗）ならずれていないとみなす。 */
export function isVersionSkewed(frontCommit: string | undefined, serverCommit: unknown): boolean {
    if (!frontCommit || frontCommit === UNKNOWN) return false;
    if (typeof serverCommit !== 'string' || serverCommit === '' || serverCommit === UNKNOWN) return false;
    return frontCommit !== serverCommit;
}

/**
 * 自動で読み込み直してよい画面（読み込み直しても失うものが無い画面）。ここに無い画面（インスタンス・ワールドの編集・ログイン・
 * CLI の承認など、今後増える画面を含む）は、知らせて利用者が選んだときに読み込み直す。
 */
const SAFE_TO_RELOAD: readonly RegExp[] = [
    /^\/$/, // ロビー
    /^\/@[^/]+\/?$/, // ユーザーページ（/@ID）
    /^\/user\/[^/]+\/?$/,
    /^\/world\/?$/, // ワールドの詳細（編集は除く）
    /^\/world\/[^/]+\/?$/,
    /^\/@[^/]+\/[^/]+\/?$/, // ワールドの共有 URL（/@ID/名前）
];

/**
 * ずれていたときにどうするか。
 * - reload: すぐ読み込み直す（失うものが無い画面で、このタブがこの backend の版のためにまだ読み込み直していない）
 * - prompt: 知らせて、利用者が選んだときに読み込み直す
 *
 * 同じ backend の版のために自動で読み込み直すのはタブごとに 1 回まで（`reloadedFor`）。デプロイの途中でフロントが
 * まだ古い間に読み込み直しを繰り返さないように、2 回目からは知らせるだけにする。
 */
export function skewAction(pathname: string, serverCommit: string, reloadedFor: string | null): 'reload' | 'prompt' {
    if (reloadedFor === serverCommit) return 'prompt';
    return SAFE_TO_RELOAD.some((re) => re.test(pathname)) ? 'reload' : 'prompt';
}

/** このタブで、どの backend の版のために自動で読み込み直したかを覚える（読み込み直しても消えない sessionStorage）。 */
const RELOADED_KEY = 'ubichill:version-skew-reloaded';

export interface ReloadMemory {
    /** 覚えていない・読めないときは null。読めない環境では「もう読み込み直した」とみなす値を返す（繰り返さないため）。 */
    reloadedFor: (serverCommit: string) => string | null;
    remember: (serverCommit: string) => void;
}

export function reloadMemory(getStorage: () => Pick<Storage, 'getItem' | 'setItem'>): ReloadMemory {
    return {
        reloadedFor: (serverCommit) => {
            try {
                return getStorage().getItem(RELOADED_KEY);
            } catch {
                return serverCommit;
            }
        },
        remember: (serverCommit) => {
            try {
                getStorage().setItem(RELOADED_KEY, serverCommit);
            } catch {
                // 覚えられない環境は reloadedFor が「読み込み直した」とみなすので、自動の読み込み直しは起きない
            }
        },
    };
}

/** 確かめる間隔（タブが前面に戻ったときにも確かめる）。 */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export async function fetchServerCommit(apiBase: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
    try {
        const res = await fetchImpl(`${apiBase}/api/version`, { cache: 'no-store' });
        if (!res.ok) return undefined;
        return ((await res.json()) as { commitHash?: unknown }).commitHash;
    } catch {
        return undefined;
    }
}
