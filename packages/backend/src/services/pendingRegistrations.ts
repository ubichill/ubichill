/**
 * メール確認待ちの仮登録。
 *
 * 仮登録は申し込んだ本人に返す ID で引く（メールアドレスでは引かない）。メールアドレスで引くと、他人が同じアドレスで
 * 申し込み直すだけで本人の仮登録をパスワードごと置き換えられ、本人が届いたコードを入れると攻撃者のパスワードの
 * アカウントができてしまう。ID で分ければ、コードを受け取れない側の仮登録は完了できない。
 */

export interface PendingRegistration {
    email: string;
    password: string;
    /** 表示名（日本語可・一意）。users.name に入る。 */
    displayName: string;
    /** URL・署名用の ID（一意）。users.handle に入る。 */
    handle: string;
}

interface Entry extends PendingRegistration {
    otp: string;
    expiresAt: number;
    failures: number;
}

export interface PendingRegistrationLimits {
    ttlMs: number;
    /** 同じメールアドレスに同時に出せる仮登録の数（確認メールを大量に送らせない）。 */
    maxPerEmail: number;
    /** コードを間違えられる回数。超えたら仮登録を捨てる（6 桁の総当たりを防ぐ）。 */
    maxFailures: number;
}

export const PENDING_REGISTRATION_LIMITS: PendingRegistrationLimits = {
    ttlMs: 10 * 60 * 1000,
    maxPerEmail: 3,
    maxFailures: 5,
};

export type VerifyOutcome =
    | { status: 'verified'; registration: PendingRegistration }
    | { status: 'not-found' | 'expired' | 'wrong-code' | 'too-many-failures' };

export interface PendingRegistrationStoreDeps {
    now: () => number;
    newId: () => string;
    newOtp: () => string;
    limits?: PendingRegistrationLimits;
}

export function createPendingRegistrationStore(deps: PendingRegistrationStoreDeps) {
    const limits = deps.limits ?? PENDING_REGISTRATION_LIMITS;
    const entries = new Map<string, Entry>();

    const sweep = (): void => {
        const now = deps.now();
        for (const [id, entry] of entries) {
            if (entry.expiresAt <= now) entries.delete(id);
        }
    };

    return {
        /** 仮登録を作る。同じアドレスの仮登録が上限に達していれば作らない。 */
        add(registration: PendingRegistration): { id: string; otp: string } | { error: 'too-many-pending' } {
            sweep();
            const sameEmail = [...entries.values()].filter((e) => e.email === registration.email).length;
            if (sameEmail >= limits.maxPerEmail) return { error: 'too-many-pending' };
            const id = deps.newId();
            const otp = deps.newOtp();
            entries.set(id, { ...registration, otp, expiresAt: deps.now() + limits.ttlMs, failures: 0 });
            return { id, otp };
        },

        /** コードを確かめる。成功したら仮登録を取り出して消す（同じコードで 2 回登録させない）。 */
        verify(id: string, otp: string): VerifyOutcome {
            const entry = entries.get(id);
            if (!entry) return { status: 'not-found' };
            if (entry.expiresAt <= deps.now()) {
                entries.delete(id);
                return { status: 'expired' };
            }
            if (entry.otp !== otp) {
                entry.failures += 1;
                if (entry.failures >= limits.maxFailures) {
                    entries.delete(id);
                    return { status: 'too-many-failures' };
                }
                return { status: 'wrong-code' };
            }
            entries.delete(id);
            const { otp: _otp, expiresAt: _expiresAt, failures: _failures, ...registration } = entry;
            return { status: 'verified', registration };
        },

        /** 本登録に失敗したときに戻す（コードを入れ直させない）。 */
        restore(id: string, registration: PendingRegistration, otp: string): void {
            entries.set(id, { ...registration, otp, expiresAt: deps.now() + limits.ttlMs, failures: 0 });
        },

        /** コードを作り直す。間違えた回数は戻さない（再送信で総当たりの回数を増やさせない）。 */
        reissue(id: string): { email: string; displayName: string; otp: string } | undefined {
            const entry = entries.get(id);
            if (!entry || entry.expiresAt <= deps.now()) return undefined;
            entry.otp = deps.newOtp();
            entry.expiresAt = deps.now() + limits.ttlMs;
            return { email: entry.email, displayName: entry.displayName, otp: entry.otp };
        },

        remove(id: string): void {
            entries.delete(id);
        },

        sweep,
    };
}

export type PendingRegistrationStore = ReturnType<typeof createPendingRegistrationStore>;
