import type { LoginMethods } from '@ubichill/shared';

/**
 * 外しても今の設定で使えるログイン方法が残る外部アカウントの id。パスワードは常に使える。
 * サーバーの判定（解除で最後の使える手段を残す）と同じ規則で、ボタンを押せるかを決める。
 */
export function removableLoginMethods(methods: LoginMethods): ReadonlySet<string> {
    const usableIds = methods.fediverse.filter((a) => a.usable).map((a) => a.id);
    return new Set(
        methods.fediverse
            .filter((account) => methods.password || usableIds.some((id) => id !== account.id))
            .map((account) => account.id),
    );
}

export type ReauthenticationWay =
    | { kind: 'password' }
    | { kind: 'fediverse'; accounts: LoginMethods['fediverse'] }
    /** 使える外部アカウントが無い（サーバーの設定で止まっている）。ログアウトしてほかの方法で入り直すしかない */
    | { kind: 'sign-in-again' };

/**
 * 直近の本人確認のしかた。パスワードがあればパスワード（サーバーはパスワードを持つ人の SSO のログインを本人確認と
 * 数えない）、無ければ今使える外部アカウントでログインし直す。読めていない（null）ときはパスワードを聞く。
 */
export function reauthenticationWay(methods: LoginMethods | null): ReauthenticationWay {
    if (methods === null || methods.password) return { kind: 'password' };
    const accounts = methods.fediverse.filter((account) => account.usable);
    return accounts.length > 0 ? { kind: 'fediverse', accounts } : { kind: 'sign-in-again' };
}

/** 直近の本人確認を先に求めるか。サーバーに断られた（読み込んだ後に 10 分を過ぎた）ら、読み込んだときの結果より優先する。 */
export function needsReauthentication(methods: LoginMethods | null, refused: boolean): boolean {
    return refused || (methods !== null && !methods.recentlyAuthenticated);
}
