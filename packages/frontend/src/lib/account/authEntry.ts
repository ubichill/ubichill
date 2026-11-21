import { safeReturnTo } from '@ubichill/shared';

/**
 * ログインの入り口（`/`）の URL のクエリ。紹介のページの上に開くダイアログと、ログインした後の戻り先を表す。
 * - `mode=login`・`mode=register`: メールアドレス（ID）とパスワードのログイン・新規登録
 * - `two_factor=1`: ログインの二段階目（パスワードの後、またはフェディバースの認証から戻った）
 * - `fediverse=sign-up`: フェディバースのアカウントで初めて来た人が ID と表示名を決める
 * - `add=1`: ログインしたまま別のアカウントを足す
 * - `next`: ログインした後に移る先（Ubichill の中の相対 URL だけ）
 */
export type AuthDialog = 'login' | 'register' | 'two-factor' | 'fediverse-sign-up';

export interface AuthEntry {
    dialog: AuthDialog | null;
    adding: boolean;
    next: string | null;
}

export function readAuthEntry(search: string): AuthEntry {
    const params = new URLSearchParams(search);
    // 外への URL など使えない戻り先は、無いのと同じにする
    const next = safeReturnTo(params.get('next'));
    return {
        dialog: dialogOf(params),
        adding: params.get('add') === '1',
        next: next === '/' ? null : next,
    };
}

function dialogOf(params: URLSearchParams): AuthDialog | null {
    if (params.get('two_factor') === '1') return 'two-factor';
    if (params.get('fediverse') === 'sign-up') return 'fediverse-sign-up';
    const mode = params.get('mode');
    if (mode === 'register') return 'register';
    if (mode === 'login') return 'login';
    return null;
}

/** ダイアログを開いた（null なら閉じた）ときのクエリ。戻り先などほかのクエリは残す。 */
export function withAuthDialog(search: string, dialog: AuthDialog | null): string {
    const params = new URLSearchParams(search);
    params.delete('mode');
    params.delete('two_factor');
    if (params.get('fediverse') === 'sign-up') params.delete('fediverse');
    if (dialog === 'login' || dialog === 'register') params.set('mode', dialog);
    if (dialog === 'two-factor') params.set('two_factor', '1');
    if (dialog === 'fediverse-sign-up') params.set('fediverse', 'sign-up');
    const rest = params.toString();
    return rest ? `?${rest}` : '';
}

/** ログインしてから `next` へ戻る、ログインの入り口の URL。 */
export function signInPath(next?: string): string {
    const target = next === undefined ? '/' : safeReturnTo(next);
    return target === '/' ? '/' : `/?next=${encodeURIComponent(target)}`;
}

/**
 * セッションの状態。unknown は確かめられていない（get-session が一時的に失敗し、SessionProvider が取り直している）。
 */
export type SessionStatus = 'pending' | 'signed-in' | 'signed-out' | 'unknown';

export type RootView = { kind: 'loading' } | { kind: 'home' } | { kind: 'visitor' } | { kind: 'redirect'; to: string };

/** `/` に何を出すか。ログインしている人はホームの部屋へ入り、していない人には紹介のページを出す。 */
export function rootView(session: SessionStatus, entry: AuthEntry): RootView {
    const signingIn = entry.dialog !== null || entry.next !== null || entry.adding;
    switch (session) {
        case 'pending':
            return { kind: 'loading' };
        case 'signed-out':
            return { kind: 'visitor' };
        // ログインしに来た人には、確かめられなくてもログインの画面を出す（ログアウトの直後の失敗で行き詰まらない）。
        // ログインしているかもしれない人は、取り直すまで待つ（紹介のページを一瞬出さない）
        case 'unknown':
            return signingIn ? { kind: 'visitor' } : { kind: 'loading' };
        case 'signed-in':
            // アカウントを足す・二段階目・フェディバースでの登録の途中は、ログインしていても続ける
            if (entry.adding || entry.dialog === 'two-factor' || entry.dialog === 'fediverse-sign-up') {
                return { kind: 'visitor' };
            }
            if (entry.next !== null) return { kind: 'redirect', to: entry.next };
            if (entry.dialog !== null) return { kind: 'redirect', to: '/' };
            return { kind: 'home' };
    }
}

/** 版のずれで読み込み直すと、入れている途中のものが消えるか（ダイアログを開いている・アカウントを足している）。 */
export function signingInProgress(search: string): boolean {
    const entry = readAuthEntry(search);
    return entry.dialog !== null || entry.adding;
}
