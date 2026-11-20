import { API_BASE, requestApi } from '@/lib/api';
import { errorMessage } from '@/lib/apiError';

/** このブラウザーでログインしたアカウント（backend の lib/accountSwitchPlugin.ts。トークンは含まない）。 */
export interface BrowserAccount {
    userId: string;
    name: string;
    handle: string;
    image: string | null;
    active: boolean;
}

async function authPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}/api/auth${path}`, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return (await res.json()) as T;
}

export async function listBrowserAccounts(): Promise<BrowserAccount[]> {
    const res = await fetch(`${API_BASE}/api/auth/account-switch/accounts`, {
        credentials: 'include',
        cache: 'no-store',
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    return ((await res.json()) as { accounts: BrowserAccount[] }).accounts;
}

export async function switchAccount(userId: string): Promise<void> {
    await authPost('/account-switch/switch', { userId });
}

/** このアカウントだけログアウトする。ほかに覚えているアカウントがあれば、その ID（切り替わった先）。 */
export async function signOutThisAccount(): Promise<string | null> {
    return (await authPost<{ next: string | null }>('/account-switch/sign-out')).next;
}

/** アカウントを削除する（退会）。確認のため自分の ID を入れ直す。 */
export async function deleteMyAccount(handle: string): Promise<void> {
    await requestApi('/users/me', { method: 'DELETE', body: JSON.stringify({ handle }) });
}

/** 別のアカウントでログインする画面（今のアカウントのまま開く）。 */
export const ADD_ACCOUNT_PATH = '/auth?add=1';
