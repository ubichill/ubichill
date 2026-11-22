import { useEffect, useState } from 'react';
import { type PortalDestination, type PortalGoal, usePortalLookup } from './portalNavigation';

/** 部屋へのポータルを出している間、入れるか（満員・空き）を引き直す間隔（ms）。 */
export const ROOM_PORTAL_REFRESH_MS = 10_000;

/**
 * 行き先のワールドを引く。引けなかったら null、まだ引いていない・引く手段が無い（world.html・エディタの部屋）ときは undefined。
 * 部屋へのポータルは出ている間 ROOM_PORTAL_REFRESH_MS ごとに引き直す（見えないタブでは引かない。同じ部屋の問い合わせは
 * lookup がまとめる）。
 */
export function usePortalDestination(goal: PortalGoal | null): PortalDestination | null | undefined {
    const lookup = usePortalLookup();
    const key = goal ? JSON.stringify(goal) : '';
    const [found, setFound] = useState<{ key: string; destination: PortalDestination | null } | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 行き先は key（中身）で比べる（goal は描くたびに作り直される）
    useEffect(() => {
        if (!lookup || !goal) return;
        const cancelled = { current: false };
        const load = () =>
            void lookup(goal).then((destination) => {
                if (cancelled.current) return;
                setFound((prev) =>
                    prev?.key === key && prev.destination === destination ? prev : { key, destination },
                );
            });
        load();
        const timer =
            goal.kind === 'room'
                ? setInterval(() => {
                      if (!document.hidden) load();
                  }, ROOM_PORTAL_REFRESH_MS)
                : undefined;
        return () => {
            cancelled.current = true;
            clearInterval(timer);
        };
    }, [lookup, key]);
    return found?.key === key ? found.destination : undefined;
}
