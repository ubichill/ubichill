/**
 * 管理者かどうかを取り直す合図。管理の API が 403 を返したとき（権限が外れた・期限が切れた）と、
 * ロールを変えたとき（自分に関わるかもしれない）に出し、useIsAdmin が受けて取り直す。
 */
const listeners = new Set<() => void>();

export function requestAdminRecheck(): void {
    for (const listener of listeners) listener();
}

export function onAdminRecheck(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** 失敗の応答が「管理者ではない」なら取り直しを頼む。 */
export function recheckIfForbidden(res: Pick<Response, 'status'>): void {
    if (res.status === 403) requestAdminRecheck();
}
