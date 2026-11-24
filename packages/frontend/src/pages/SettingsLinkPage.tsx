import { useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { keepSettingsLink, settingsLinkOf } from '@/components/hud/settingsLink';
import { RouteLoading } from '@/components/ProtectedRoute';

/** `/settings/:section`。開く欄を持ち越してホームへ移る（部屋に入ったらランチパッドの設定をその欄で開く）。 */
export function SettingsLinkPage() {
    const { section } = useParams<{ section: string }>();
    const { search } = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        const link = settingsLinkOf(section, search);
        if (link) keepSettingsLink(sessionStorage, link);
        navigate('/', { replace: true });
    }, [section, search, navigate]);

    return <RouteLoading />;
}
