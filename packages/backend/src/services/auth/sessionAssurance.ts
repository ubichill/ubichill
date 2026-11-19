/**
 * セッションがどこまで本人を確かめたか。外部の SSO はそのサーバーが乗っ取られると誰にでもなれる。
 * - 管理者の操作は、SSO と独立した確認（パスワード）を済ませたセッションだけに許す。
 * - パスワードを持つユーザーは、アカウントの安全に関わる操作（ログイン方法・公開環境・CLI の承認・ほかの端末の
 *   ログアウト）もパスワードを確かめたセッションに限る。SSO の乗っ取りを、乗っ取りが終わった後も残る権限
 *   （足したログイン方法・API トークン）に変えさせないため。パスワードの無いユーザーは SSO が唯一の手段なので限らない。
 * - ログイン方法を変える操作は、奪われた古いセッションで手段を足されないよう、直近の本人確認を求める。
 */

/** ログイン方法の追加・解除に求める「直近」の長さ。 */
export const RECENT_AUTHENTICATION_MS = 10 * 60 * 1000;

export interface SessionFacts {
    createdAt: Date;
    passwordVerifiedAt: Date | null;
}

/** このセッションでパスワードを確かめたか（ログイン・変更・再認証のどれか）。 */
export function isPasswordVerified(session: SessionFacts): boolean {
    return session.passwordVerifiedAt !== null;
}

/** アカウントの安全に関わる操作をこのセッションでできるか（パスワードを持つ人は、パスワードを確かめたセッション）。 */
export function isStrongSession(session: SessionFacts, hasPassword: boolean): boolean {
    return !hasPassword || isPasswordVerified(session);
}

/**
 * 直近に本人を確かめたか。パスワードを持つ人はパスワードを 10 分以内に確かめたこと、持たない人は 10 分以内に
 * ログインしたこと（SSO でログインし直す）。
 */
export function isRecentlyAuthenticated(session: SessionFacts, now: Date, hasPassword: boolean): boolean {
    const recent = (at: Date | null) => at !== null && now.getTime() - at.getTime() <= RECENT_AUTHENTICATION_MS;
    return recent(session.passwordVerifiedAt) || (!hasPassword && recent(session.createdAt));
}

/** 管理者の権限をこのセッションで使えるか。 */
export function canActAsAdmin(isAdminUser: boolean, session: SessionFacts): boolean {
    return isAdminUser && isPasswordVerified(session);
}

/** 文字列・Date・null のどれで来ても Date | null にする（better-auth のクッキーキャッシュは文字列で返す）。 */
export function toDateOrNull(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}
