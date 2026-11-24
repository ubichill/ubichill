import { type ReactNode, useMemo, useState } from 'react';
import { pushToast } from '@/lib/toast';
import { isRemoteRoomAddress, requestRoomPortalGrant } from '@/lib/worlds/instancesApi';
import { placeRoomPortal } from '@/lib/worlds/roomPortalPlacement';
import { PortalPlacementLayer, useRoomPortalActions } from '@/world';
import type { PortalOpener, PortalTarget } from './HudNavigationContext';

export interface PortalPlacement {
    /** ランチパッドの中の画面に渡す */
    opener: PortalOpener;
    /** 置く場所を選ぶ画面（選んでいなければ null）。ランチパッドを閉じても残る所に置く */
    layer: ReactNode;
}

/**
 * ランチパッドから部屋へのポータルを置く。ランチパッドを閉じて置く場所を選ばせ、選んでから行き先を決め（新しいインスタンスは
 * ここで作る）、backend に置く許可をもらう（プライベートのワールドの部屋へは部屋を作った人だけ。インスタンスが許可を確かめる）。
 * ほかのサーバーの部屋では置かない: 行き先は部屋のサーバーから見た住所で書くが、ランチパッドの部屋は自分のサーバーから見た
 * 住所で、自分のサーバーのドメインをここでは知らないため。
 */
export function usePortalPlacement(currentInstanceId: string, closeLaunchpad: () => void): PortalPlacement {
    const actions = useRoomPortalActions();
    const [target, setTarget] = useState<PortalTarget | null>(null);
    const unavailable = isRemoteRoomAddress(currentInstanceId)
        ? 'ほかのサーバーの部屋には、ポータルを置けません'
        : null;

    const opener = useMemo<PortalOpener>(
        () => ({
            unavailable,
            place: (next) => {
                if (unavailable) return;
                closeLaunchpad();
                setTarget(next);
            },
        }),
        [unavailable, closeLaunchpad],
    );

    const layer = target && (
        <PortalPlacementLayer
            look={target.look}
            onCancel={() => setTarget(null)}
            onPlace={async (at) => {
                const error = await placeRoomPortal(
                    { requestGrant: requestRoomPortalGrant, open: actions.open },
                    target.room,
                    at,
                );
                if (error) pushToast(error, 'error');
                setTarget(null);
            }}
        />
    );
    return { opener, layer };
}
