import { keyRegistrationMessage, type WorldSigningKey } from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

/** ログイン中のアカウント（`GET /api/v1/users/me`）。 */
export interface MyAccount {
    id: string;
    /** 表示名（日本語可・一意・変更可）。 */
    name: string;
    /** 移行時に他人と表示名が重複していた。変更を促す。 */
    displayNameConflict: boolean;
    /** 初期パスワードのまま。変更を促す。 */
    passwordChangeRequired: boolean;
    /** このサーバーの管理者（公式アカウント）。 */
    isAdmin: boolean;
    /** URL・署名用の ID。既存ユーザーは未設定のことがある。 */
    handle: string | null;
    /** 作者アカウント `handle@domain`（handle 未設定なら null）。 */
    author: string | null;
    /** アカウントに登録済みの署名公開鍵。 */
    signingPublicKey: string | null;
    profileImageUrl: string | null;
}

async function errorMessage(res: Response): Promise<string> {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? `HTTP ${res.status}`;
}

export async function fetchMyAccount(): Promise<MyAccount> {
    const res = await fetch(`${API_BASE}/api/v1/users/me`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as MyAccount;
}

/** パスワードを変更する（他の端末のセッションは無効になる）。 */
export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
}

/** 表示名を変更する（一意）。 */
export async function setMyDisplayName(name: string): Promise<{ name: string }> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/display-name`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as { name: string };
}

/** ID を設定する（変更不可。未設定のアカウントのみ）。 */
export async function setMyHandle(handle: string): Promise<{ handle: string; author: string }> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/handle`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as { handle: string; author: string };
}

/**
 * このブラウザの鍵をアカウントの署名鍵として登録する（既存の鍵は置き換わる）。
 * 公開鍵だけでなく「その鍵で自分の userId 入りの文に署名したもの」を送り、秘密鍵の所有を証明する。
 */
export async function registerSigningKey(userId: string, key: WorldSigningKey): Promise<void> {
    const claim = { userId, publicKey: key.publicKey, at: new Date().toISOString() };
    const signature = await key.sign(keyRegistrationMessage(claim));
    const res = await fetch(`${API_BASE}/api/v1/users/me/signing-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ publicKey: claim.publicKey, at: claim.at, signature }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
}
