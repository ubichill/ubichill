import { fediverseSignInErrorMessage } from '@ubichill/shared';

/** 認証から戻ったときの URL のクエリ（`fediverse`・`fediverse_error`）を読む。 */
export function readFediverseReturn(search: string): { signUp: boolean; linked: boolean; error: string | null } {
    const params = new URLSearchParams(search);
    return {
        signUp: params.get('fediverse') === 'sign-up',
        linked: params.get('fediverse') === 'linked',
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
