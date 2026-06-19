import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { authClient, useSession } from '@/lib/auth-client';

interface ProtectedRouteProps {
    children: ReactNode;
}

/** 一度確立したセッションが一時的に null になったとき、/auth へ飛ばすまでに待つ猶予 (ms)。 */
const REVALIDATE_GRACE_MS = 3000;

const Loading = () => (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>読み込み中...</p>
    </div>
);

export function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { data: session, isPending } = useSession();
    const location = useLocation();

    // 一度でもセッションが確立したか（このマウント中）。
    // 確立後に null へ転じた場合は「本当のログアウト」より
    // 「dev のバックエンド再起動などで session 取得が一過性に失敗した」可能性が高い。
    const hadSessionRef = useRef(false);
    const [graceExpired, setGraceExpired] = useState(false);

    useEffect(() => {
        if (session) {
            hadSessionRef.current = true;
            setGraceExpired(false);
        }
    }, [session]);

    // 一過性 null の間は即リダイレクトせず、再検証を促して猶予を与える。
    // 猶予内に session が復活すれば留まり、復活しなければ /auth へ。
    useEffect(() => {
        if (isPending || session || !hadSessionRef.current) return;
        void authClient.getSession();
        const timer = setTimeout(() => setGraceExpired(true), REVALIDATE_GRACE_MS);
        return () => clearTimeout(timer);
    }, [isPending, session]);

    if (isPending) return <Loading />;
    if (session) return <>{children}</>;

    // 一度もセッションが無かった（=純粋な未認証）なら即リダイレクト。
    // 一度あったなら猶予が切れるまでは再検証中として待つ。
    if (hadSessionRef.current && !graceExpired) return <Loading />;

    return <Navigate to="/auth" state={{ from: location }} replace />;
}
