import { Navigate, useLocation } from 'react-router';
import { RouteLoading } from '@/components/ProtectedRoute';
import { readAuthEntry, rootView, type SessionStatus } from '@/lib/account/authEntry';
import { isUnauthorized, useSession } from '@/lib/session';
import { HomePage } from './HomePage';
import { VisitorPage } from './VisitorPage';

/**
 * `/`。ログインしている人はホームの部屋へ入り、していない人にはサーバーの紹介とログインの入り口を出す。
 * ログインの画面はここだけ（以前の /auth はここへ移す）。
 */
export function RootPage() {
    const session = useSession();
    const location = useLocation();
    const entry = readAuthEntry(location.search);
    const view = rootView(sessionStatusOf(session), entry);

    switch (view.kind) {
        case 'loading':
            return <RouteLoading />;
        case 'home':
            return <HomePage />;
        case 'visitor':
            return <VisitorPage entry={entry} />;
        case 'redirect':
            return <Navigate to={view.to} replace />;
    }
}

function sessionStatusOf({ data, isPending, error }: ReturnType<typeof useSession>): SessionStatus {
    if (isPending) return 'pending';
    if (data) return 'signed-in';
    return error && !isUnauthorized(error) ? 'unknown' : 'signed-out';
}
