import { useEffect, useState } from 'react';
import { fetchMyAccount } from './me';

/** ログイン中の人がこのサーバーの管理者か（確かめるまでと、別の人に替わった直後は false）。 */
export function useIsAdmin(userId: string | undefined): boolean {
    const [checked, setChecked] = useState<{ userId: string; isAdmin: boolean } | null>(null);
    useEffect(() => {
        if (!userId) return;
        const ctrl = { cancelled: false };
        fetchMyAccount()
            .then((account) => !ctrl.cancelled && setChecked({ userId, isAdmin: account.isAdmin }))
            .catch(() => undefined);
        return () => {
            ctrl.cancelled = true;
        };
    }, [userId]);
    return !!userId && checked?.userId === userId && checked.isAdmin;
}
