import { useEffect, useState } from 'react';
import { onAdminRecheck } from './adminStatus';
import { fetchMyAccount } from './me';

/** 開いている間に取り直す間隔（ロールの期限切れを拾う） */
const RECHECK_INTERVAL_MS = 60_000;

/**
 * ログイン中の人がこのサーバーの管理者か（確かめるまでと、別の人に替わった直後は false）。
 * 管理の API が 403 を返したとき・ロールを変えたとき・画面に戻ってきたとき・開いている間は 1 分ごとに取り直す。
 */
export function useIsAdmin(userId: string | undefined): boolean {
    const [checked, setChecked] = useState<{ userId: string; isAdmin: boolean } | null>(null);
    useEffect(() => {
        if (!userId) return;
        const ctrl = { cancelled: false };
        const check = () => {
            fetchMyAccount()
                .then((account) => !ctrl.cancelled && setChecked({ userId, isAdmin: account.isAdmin }))
                .catch(() => undefined);
        };
        const onVisible = () => {
            if (!document.hidden) check();
        };
        check();
        const off = onAdminRecheck(check);
        const timer = setInterval(onVisible, RECHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            ctrl.cancelled = true;
            off();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [userId]);
    return !!userId && checked?.userId === userId && checked.isAdmin;
}
