import { useEffect, useState } from 'react';
import { type PortalDestination, type PortalGoal, usePortalLookup } from './portalNavigation';

/** 鍵の付いた・無い・確かめられない部屋へのポータルを、出している間に引き直す間隔（ms）。 */
export const ROOM_PORTAL_REFRESH_MS = 10_000;

/**
 * 引き直すか。入れると分かっている部屋は引き直さない（あとで満員になっても、移る直前に確かめる）。
 * 鍵の付いた・無い・確かめられない部屋は、空きができた・戻ったのを出すために引き直す。
 */
export const needsRefresh = (destination: PortalDestination | null | undefined): boolean =>
    destination === null || destination?.locked === true || destination?.unknown === true;

/**
 * 行き先のワールドを引く。引けなかったら null、まだ引いていない・引く手段が無い（world.html・エディタの部屋）ときは undefined。
 * 部屋へのポータルは、needsRefresh の間 ROOM_PORTAL_REFRESH_MS ごとと、タブが見えるようになったときに引き直す
 * （見えないタブでは引かない。同じ部屋の問い合わせは lookup がまとめる）。
 */
export function usePortalDestination(goal: PortalGoal | null): PortalDestination | null | undefined {
    const lookup = usePortalLookup();
    const key = goal ? JSON.stringify(goal) : '';
    const [found, setFound] = useState<{ key: string; destination: PortalDestination | null } | null>(null);
    const destination = found?.key === key ? found.destination : undefined;
    const watching = goal?.kind === 'room' && needsRefresh(destination);
    // biome-ignore lint/correctness/useExhaustiveDependencies: 行き先は key（中身）で比べる（goal は描くたびに作り直される）
    useEffect(() => {
        if (!lookup || !goal) return;
        const cancelled = { current: false };
        const load = () =>
            void lookup(goal).then((next) => {
                if (cancelled.current) return;
                setFound((prev) =>
                    prev?.key === key && prev.destination === next ? prev : { key, destination: next },
                );
            });
        load();
        const refresh = () => {
            if (!document.hidden) load();
        };
        const timer = watching ? setInterval(refresh, ROOM_PORTAL_REFRESH_MS) : undefined;
        if (watching) document.addEventListener('visibilitychange', refresh);
        return () => {
            cancelled.current = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', refresh);
        };
    }, [lookup, key, watching]);
    return destination;
}
