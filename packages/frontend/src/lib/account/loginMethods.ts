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
