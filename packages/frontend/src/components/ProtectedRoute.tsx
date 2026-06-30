import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { isUnauthorized, useSession } from '@/lib/session';

interface ProtectedRouteProps {
    children: ReactNode;
}

const Loading = () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>読み込み中...</p>
    </div>
);

/**
 * 認証ガード。
 *
 * 一過性の get-session 失敗で勝手に /auth へ飛ばさないための判定は SessionProvider に
 * 一本化されている（直近セッションの保持＋バックオフ再取得）。ここでは:
 *   - 取得中 → ローディング
 *   - セッションあり → 子を表示
 *   - セッション未確立かつ一過性エラー（401 以外）→ provider が再試行中なので待つ
 *   - それ以外（明示的な未認証 / 401）→ /auth へ
 * とするだけでよい。
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { data: session, isPending, error } = useSession();
    const location = useLocation();

    if (isPending) return <Loading />;
    if (session) return <>{children}</>;
    if (error && !isUnauthorized(error)) return <Loading />;

    return <Navigate to="/auth" state={{ from: location }} replace />;
}
