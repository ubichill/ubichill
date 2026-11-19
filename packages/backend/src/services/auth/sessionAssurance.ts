/**
 * セッションがどこまで本人を確かめたか。外部の SSO はそのサーバーが乗っ取られると誰にでもなれるので、
 * 管理者の操作は SSO と独立した確認（パスワード）を済ませたセッションだけに許す。ログイン方法を変える操作は、
 * 奪われたセッションで手段を足されないよう、直近にログインか再認証をしたセッションだけに許す。
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

/** 直近にログインしたか、パスワードで再認証したか。 */
export function isRecentlyAuthenticated(session: SessionFacts, now: Date): boolean {
    const latest = Math.max(session.createdAt.getTime(), session.passwordVerifiedAt?.getTime() ?? 0);
    return now.getTime() - latest <= RECENT_AUTHENTICATION_MS;
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
