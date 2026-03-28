import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@/lib/auth-client';

interface ProtectedRouteProps {
    children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { data: session, isPending } = useSession();
    const location = useLocation();

    if (isPending) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <p>読み込み中...</p>
            </div>
        );
    }

    if (!session) {
        return <Navigate to="/auth" state={{ from: location }} replace />;
    }

    return <>{children}</>;
}
