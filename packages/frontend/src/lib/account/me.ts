import {
    type FavoritesVisibility,
    keyRegistrationMessage,
    type PublishingEnvironmentKind,
    type RevokeReason,
    type WorldSigningKey,
} from '@ubichill/shared';
import { API_BASE } from '@/lib/api';

/** ログイン中のアカウント（`GET /api/v1/users/me`）。 */
export interface MyAccount {
    id: string;
    /** 表示名（日本語可・一意・変更可）。 */
    name: string;
    /** 移行時に他人と表示名が重複していた。変更を促す。 */
    displayNameConflict: boolean;
    /** 公開済みの開発用既定パスワードのまま（公式アカウント）。Secret の設定を促す。 */
    passwordChangeRequired: boolean;
    /** パスワードをサーバーの設定（Secret）で管理している（画面から変更できない）。 */
    passwordManagedBySecret: boolean;
    /** このサーバーの管理者（公式アカウント）。 */
    isAdmin: boolean;
    /** URL・署名用の ID。既存ユーザーは未設定のことがある。 */
    handle: string | null;
    /** 作者アカウント `handle@domain`（handle 未設定なら null）。 */
    author: string | null;
    /** 取り消されていない公開環境の鍵（このブラウザの鍵が登録済みかの判定に使う）。 */
    signingKeys: string[];
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

/** 公開環境（署名して公開できるブラウザ・CLI・CI）。 */
export interface PublishingEnvironment {
    id: string;
    kind: PublishingEnvironmentKind;
    name: string;
    publicKey: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    revokeReason: RevokeReason | null;
}

export async function fetchPublishingEnvironments(): Promise<PublishingEnvironment[]> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/publishing-environments`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { environments: PublishingEnvironment[] }).environments;
}

/** 公開環境を取り消す。その鍵の署名は取り消し前のものも含めて作者が付かなくなる。 */
export async function revokePublishingEnvironment(id: string, reason: RevokeReason): Promise<PublishingEnvironment> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/publishing-environments/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { environment: PublishingEnvironment }).environment;
}

/**
 * このブラウザの鍵を公開環境として登録する。公開鍵だけでなく「その鍵で自分の userId 入りの文に署名したもの」を送り、
 * 秘密鍵の所有を証明する。鍵が取り消し済み（revoked）・他のアカウントが登録済み（taken）なら作り直しが必要。
 */
export async function registerSigningKey(
    userId: string,
    key: WorldSigningKey,
): Promise<'registered' | 'revoked' | 'taken'> {
    const claim = { userId, publicKey: key.publicKey, at: new Date().toISOString() };
    const signature = await key.sign(keyRegistrationMessage(claim));
    const res = await fetch(`${API_BASE}/api/v1/users/me/publishing-environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ publicKey: claim.publicKey, at: claim.at, signature }),
    });
    if (res.status === 409) {
        const data = (await res
            .clone()
            .json()
            .catch(() => ({}))) as { code?: string };
        if (data.code === 'revoked' || data.code === 'taken') return data.code;
    }
    if (!res.ok) throw new Error(await errorMessage(res));
    return 'registered';
}

/** いま使っているもの以外のログインをすべて無効にする（乗っ取りに気付いたとき）。無効にした数を返す。 */
export async function revokeOtherSessions(): Promise<number> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/sessions/revoke-others`, {
        method: 'POST',
        credentials: 'include',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { revoked: number }).revoked;
}

/** お気に入り一覧の公開範囲を変更する。 */
export async function setMyFavoritesVisibility(visibility: FavoritesVisibility): Promise<FavoritesVisibility> {
    const res = await fetch(`${API_BASE}/api/v1/users/me/favorites/visibility`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ visibility }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { visibility: FavoritesVisibility }).visibility;
}
