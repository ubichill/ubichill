import { useMemo } from 'react';
import { pushToast } from '@/lib/toast';
import { isRemoteRoomAddress, requestRoomPortalGrant } from '@/lib/worlds/instancesApi';
import { useRoomPortalActions } from '@/world';
import type { PortalOpener } from './HudNavigationContext';

/**
 * ランチパッドから部屋へのポータルを置く。先に backend に置く許可をもらう（プライベートのワールドの部屋へは部屋を作った人
 * だけ。インスタンスが許可を確かめる）。ほかのサーバーの部屋では置かない: 行き先は部屋のサーバーから見た住所で書くが、
 * ランチパッドの部屋は自分のサーバーから見た住所で、自分のサーバーのドメインをここでは知らないため。
 */
export function usePortalOpener(currentInstanceId: string, onClose: () => void): PortalOpener {
    const actions = useRoomPortalActions();
    return useMemo(
        () => ({
            unavailable: isRemoteRoomAddress(currentInstanceId)
                ? 'ほかのサーバーの部屋には、ポータルを置けません'
                : null,
            open: async (room) => {
                const error = await requestRoomPortalGrant(room).then(
                    (grant) => actions.open(room, grant),
                    (e: unknown) => (e instanceof Error ? e.message : 'ポータルを置けませんでした'),
                );
                if (error) {
                    pushToast(error, 'error');
                    return false;
                }
                onClose();
                return true;
            },
        }),
        [actions, currentInstanceId, onClose],
    );
}
