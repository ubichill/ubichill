/**
 * 配信中のフロントに更新があれば読み込み直す（判定は lib/versionSkew）。
 * 自動で読み込み直すのは失うものが無い画面だけ、同じ配信版のためにはタブごとに 1 回だけ。ほかは知らせる。
 */
import { useEffect, useRef } from 'react';
import { pushToast } from '@/lib/toast';
import {
    fetchFrontendCommit,
    isVersionSkewed,
    reloadMemory,
    skewAction,
    VERSION_CHECK_INTERVAL_MS,
} from '@/lib/versionSkew';

const FRONT_COMMIT = import.meta.env.VITE_COMMIT_HASH;

export function VersionSkewGuard() {
    const notified = useRef(false);
    useEffect(() => {
        let cancelled = false;
        const memory = reloadMemory(() => window.sessionStorage);
        const check = async () => {
            const publishedCommit = await fetchFrontendCommit(import.meta.env.BASE_URL);
            if (cancelled || !isVersionSkewed(FRONT_COMMIT, publishedCommit) || typeof publishedCommit !== 'string')
                return;
            if (
                skewAction(window.location.pathname, publishedCommit, memory.reloadedFor(publishedCommit)) === 'reload'
            ) {
                memory.remember(publishedCommit);
                window.location.reload();
                return;
            }
            if (notified.current) return;
            notified.current = true;
            pushToast('新しい版が出ています。読み込み直すと最新の版で動きます', 'info', {
                label: '読み込み直す',
                run: () => window.location.reload(),
            });
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') void check();
        };
        const timer = setInterval(() => void check(), VERSION_CHECK_INTERVAL_MS);
        document.addEventListener('visibilitychange', onVisible);
        void check();
        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);
    return null;
}
