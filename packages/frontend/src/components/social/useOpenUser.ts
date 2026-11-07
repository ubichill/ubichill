import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useHudNavigation } from '@/components/hud/HudNavigationContext';
import { userPagePath } from '@/lib/userPath';

/** 人のプロフィールを開く。ランチパッドの中ならその場で重ね（部屋から抜けない）、外ならユーザーページへ移る。 */
export function useOpenUser(onNavigate?: () => void) {
    const hud = useHudNavigation();
    const navigate = useNavigate();
    return useCallback(
        (user: { id: string; handle: string }) => {
            if (hud) {
                hud.openUser(user.id);
                return;
            }
            onNavigate?.();
            navigate(userPagePath(user));
        },
        [hud, navigate, onNavigate],
    );
}
