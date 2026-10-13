/**
 * フロントと backend の版がずれたら読み込み直す（判定は lib/versionSkew）。単体モード（SNS backend なし）では何もしない。
 */
import { useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/api';
import { STANDALONE_RUNTIME } from '@/lib/instanceConnection';
import { pushToast } from '@/lib/toast';
import { fetchServerCommit, isVersionSkewed, skewAction, VERSION_CHECK_INTERVAL_MS } from '@/lib/versionSkew';

const FRONT_COMMIT = import.meta.env.VITE_COMMIT_HASH;

export function VersionSkewGuard() {
    const notified = useRef(false);
    useEffect(() => {
        if (STANDALONE_RUNTIME) return;
        const check = async () => {
            if (!isVersionSkewed(FRONT_COMMIT, await fetchServerCommit(API_BASE))) return;
            if (skewAction(window.location.pathname) === 'reload') {
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
