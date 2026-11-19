import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { readFediverseReturn, withoutFediverseReturn } from '@/lib/account/fediverseReturn';
import { pushToast } from '@/lib/toast';

/**
 * フェディバースの認証から戻ったとき（設定での追加・登録済みだった新規登録）、結果を知らせてクエリを外す。
 * ログイン画面（/auth）は自分で表示するので、ここでは扱わない。
 */
export function FediverseReturnNotice() {
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (location.pathname === '/auth') return;
        const returned = readFediverseReturn(location.search);
        if (!returned.linked && !returned.alreadyRegistered && !returned.error) return;
        if (returned.linked) pushToast('フェディバースのアカウントを追加しました', 'info');
        if (returned.alreadyRegistered) pushToast('このアカウントは登録済みだったので、ログインしました', 'info');
        if (returned.error) pushToast(returned.error, 'error');
        navigate(
            { pathname: location.pathname, search: withoutFediverseReturn(location.search), hash: location.hash },
            { replace: true },
        );
    }, [location.pathname, location.search, location.hash, navigate]);

    return null;
}
