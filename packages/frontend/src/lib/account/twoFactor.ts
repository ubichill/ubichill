import type {
    TwoFactorBackupCodes,
    TwoFactorSetup,
    TwoFactorSignedIn,
    TwoFactorSignInError,
    TwoFactorStatus,
} from '@ubichill/shared';
import { API_BASE, requestApi } from '@/lib/api';
import { errorMessage } from '@/lib/apiError';

/** 設定の「二段階認証」の状態。 */
export async function fetchTwoFactorStatus(): Promise<TwoFactorStatus> {
    return requestApi<TwoFactorStatus>('/users/me/two-factor');
}

/** 設定を始める（認証アプリに登録する鍵を受け取る）。直近の本人確認が要るときは 'reauth-required'。 */
export async function beginTwoFactorSetup(): Promise<TwoFactorSetup | 'reauth-required'> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/two-factor/setup`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
    });
    if (res.status === 403) return 'reauth-required';
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as TwoFactorSetup;
}

const withCode = (code: string): RequestInit => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
});

/** 認証アプリのコードで確かめて有効にし、バックアップコードを受け取る。 */
export async function enableTwoFactor(code: string): Promise<string[]> {
    return (await requestApi<TwoFactorBackupCodes>('/users/me/two-factor/enable', withCode(code))).backupCodes;
}

export async function disableTwoFactor(code: string): Promise<void> {
    await requestApi('/users/me/two-factor/disable', withCode(code));
}

export async function regenerateBackupCodes(code: string): Promise<string[]> {
    return (await requestApi<TwoFactorBackupCodes>('/users/me/two-factor/backup-codes', withCode(code))).backupCodes;
}

/** ログインの二段階目の失敗（`challenge-expired` なら最初からログインし直す）。 */
export class TwoFactorSignInFailure extends Error {
    constructor(
        message: string,
        readonly code: TwoFactorSignInError | null,
    ) {
        super(message);
    }
}

const SIGN_IN_ERRORS: ReadonlySet<string> = new Set<TwoFactorSignInError>([
    'challenge-expired',
    'invalid-code',
    'locked',
]);

/** ログインの二段階目のコードを送る。通ればセッションのクッキーが付き、戻る先を返す。 */
export async function verifyTwoFactorSignIn(code: string): Promise<TwoFactorSignedIn> {
    const res = await fetch(`${API_BASE}/api/auth/two-factor/verify`, {
        ...withCode(code),
        credentials: 'include',
        cache: 'no-store',
    }).catch(() => {
        throw new TwoFactorSignInFailure('Ubichill に接続できませんでした。ネットワークを確かめてください', null);
    });
    const body = (await res.json().catch(() => ({}))) as Partial<TwoFactorSignedIn> & {
        code?: string;
        message?: string;
    };
    if (res.ok) return { returnTo: body.returnTo ?? null };
    if (res.status === 429 && !body.code) {
        throw new TwoFactorSignInFailure('コードの入力が多すぎます。しばらくしてからお試しください', 'locked');
    }
    const errorCode = body.code && SIGN_IN_ERRORS.has(body.code) ? (body.code as TwoFactorSignInError) : null;
    throw new TwoFactorSignInFailure(body.message ?? `うまくいきませんでした（HTTP ${res.status}）`, errorCode);
}
