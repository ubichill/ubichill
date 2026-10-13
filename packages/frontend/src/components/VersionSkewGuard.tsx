/**
 * フロントと backend の版がずれたら読み込み直す（判定は lib/versionSkew）。単体モード（SNS backend なし）では何もしない。
 * 自動で読み込み直すのは失うものが無い画面だけ、同じ backend の版のためにはタブごとに 1 回だけ。ほかは知らせる。
 */
import { useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/api';
import { STANDALONE_RUNTIME } from '@/lib/instanceConnection';
import { pushToast } from '@/lib/toast';
import {
    fetchServerCommit,
    isVersionSkewed,
    reloadMemory,
    skewAction,
    VERSION_CHECK_INTERVAL_MS,
} from '@/lib/versionSkew';

const FRONT_COMMIT = import.meta.env.VITE_COMMIT_HASH;

export function VersionSkewGuard() {
    const notified = useRef(false);
    useEffect(() => {
        if (STANDALONE_RUNTIME) return;
        const memory = reloadMemory(() => window.sessionStorage);
        const check = async () => {
            const serverCommit = await fetchServerCommit(API_BASE);
            if (!isVersionSkewed(FRONT_COMMIT, serverCommit) || typeof serverCommit !== 'string') return;
            if (skewAction(window.location.pathname, serverCommit, memory.reloadedFor(serverCommit)) === 'reload') {
                memory.remember(serverCommit);
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
            clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);
    return null;
}
