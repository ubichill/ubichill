import { useCallback } from 'react';
import { fetchUserByHandle } from '@/lib/socialApi';
import { pushToast } from '@/lib/toast';
import { useOpenUser } from './useOpenUser';

/** アカウント（`handle@domain`。このサーバーの人も可）から人を引いて、プロフィールを開く（自己紹介のメンション）。 */
export function useOpenAccount() {
    const openUser = useOpenUser();
    return useCallback(
        async (account: string) => {
            try {
                const user = await fetchUserByHandle(account);
                openUser({ id: user.id, handle: user.handle });
            } catch {
                pushToast(`@${account} のプロフィールを開けませんでした`, 'error');
            }
        },
        [openUser],
    );
}
