import type { AccountSessionView } from '@ubichill/shared';
import { requestApi } from '@/lib/api';

/** ログイン中の端末（新しく使った順）。 */
export async function fetchAccountSessions(): Promise<AccountSessionView[]> {
    return (await requestApi<{ sessions: AccountSessionView[] }>('/users/me/sessions')).sessions;
}

/** ほかの端末を 1 つログアウトする。 */
export async function revokeAccountSession(id: string): Promise<void> {
    await requestApi(`/users/me/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
