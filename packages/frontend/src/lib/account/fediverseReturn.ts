import { fediverseSignInErrorMessage, safeReturnTo } from '@ubichill/shared';

/**
 * ログイン画面に渡された戻り先（`location.state.from`）を Ubichill 内の相対 URL の文字列にする。
 * ProtectedRoute は Location のオブジェクトを、ほかの画面は文字列を渡す。
 */
export function returnPathOf(state: unknown): string {
    const from = (state as { from?: unknown } | null)?.from;
    if (typeof from === 'string') return safeReturnTo(from);
    if (from && typeof from === 'object') {
        const { pathname, search, hash } = from as { pathname?: unknown; search?: unknown; hash?: unknown };
        const part = (v: unknown) => (typeof v === 'string' ? v : '');
        return safeReturnTo(`${part(pathname)}${part(search)}${part(hash)}`);
    }
    return '/';
}

/** 認証から戻ったときの URL のクエリ（`fediverse`・`fediverse_error`）を読む。 */
export function readFediverseReturn(search: string): {
    signUp: boolean;
    linked: boolean;
    alreadyRegistered: boolean;
    error: string | null;
} {
    const params = new URLSearchParams(search);
    return {
        signUp: params.get('fediverse') === 'sign-up',
        linked: params.get('fediverse') === 'linked',
        alreadyRegistered: params.get('fediverse') === 'already-registered',
        error: fediverseSignInErrorMessage(params.get('fediverse_error')),
    };
}

/** 戻ったときのクエリを外した URL（知らせを出した後、再読み込みで繰り返さないように）。 */
export function withoutFediverseReturn(search: string): string {
    const params = new URLSearchParams(search);
    params.delete('fediverse');
    params.delete('fediverse_error');
    const rest = params.toString();
    return rest ? `?${rest}` : '';
}
