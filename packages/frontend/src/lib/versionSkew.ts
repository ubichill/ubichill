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
 * ずれていたときにどうするか。
 * - reload: すぐ読み込み直す（インスタンスの外。失うものが無い）
 * - prompt: 知らせて、利用者が選んだときに読み込み直す（インスタンスの中。共同作業を急に切らない）
 */
export function skewAction(pathname: string): 'reload' | 'prompt' {
    return pathname.startsWith('/instance/') ? 'prompt' : 'reload';
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
