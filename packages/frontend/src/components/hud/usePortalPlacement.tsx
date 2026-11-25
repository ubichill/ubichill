import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pushToast } from '@/lib/toast';
import { isRemoteRoomAddress, requestRoomPortalGrant } from '@/lib/worlds/instancesApi';
import { PORTAL_COOLDOWN_MESSAGE, placeRoomPortal, portalCooldownRemaining } from '@/lib/worlds/roomPortalPlacement';
import { PortalPlacementLayer, useRoomPortalActions } from '@/world';
import type { PortalOpener, PortalTarget } from './HudNavigationContext';

export interface PortalPlacement {
    /** ランチパッドの中の画面に渡す */
    opener: PortalOpener;
    /** 置く場所を選ぶ画面（選んでいなければ null）。ランチパッドを閉じても残る所に置く */
    layer: ReactNode;
    /** 選ぶのをやめる（置いている途中なら取りやめる）。ランチパッドを開いたときに呼ぶ */
    cancel: () => void;
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
    const inFlight = useRef<AbortController | null>(null);
    const lastPlacedAt = useRef<number | null>(null);
    // インスタンスに送ったあと（返事を待つ間）は、やめても置かれるので、やめさせない
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);
    const unavailable = isRemoteRoomAddress(currentInstanceId)
        ? 'ほかのサーバーのインスタンスには、ポータルを置けません'
        : null;

    const cancel = useCallback(() => {
        if (sendingRef.current) return;
        inFlight.current?.abort();
        inFlight.current = null;
        setTarget(null);
    }, []);
    useEffect(() => () => inFlight.current?.abort(), []);

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

    const place = async (chosen: PortalTarget, at: { x: number; y: number }) => {
        // インスタンスに断られるのが分かっている間は、部屋を作らずに選び直してもらう
        if (portalCooldownRemaining(lastPlacedAt.current, Date.now()) > 0) {
            pushToast(PORTAL_COOLDOWN_MESSAGE, 'error');
            return;
        }
        const controller = new AbortController();
        inFlight.current = controller;
        const error = await placeRoomPortal(
            {
                requestGrant: requestRoomPortalGrant,
                open: (room, spot, grant) => {
                    sendingRef.current = true;
                    setSending(true);
                    return actions.open(room, spot, grant);
                },
            },
            chosen.room,
            at,
            controller.signal,
        );
        const sent = sendingRef.current;
        sendingRef.current = false;
        setSending(false);
        if (controller.signal.aborted && !sent) return;
        inFlight.current = null;
        if (error) pushToast(error, 'error');
        else lastPlacedAt.current = Date.now();
        setTarget(null);
    };

    const layer = target && (
        <PortalPlacementLayer
            look={target.look}
            cancellable={!sending}
            onCancel={cancel}
            onPlace={(at) => place(target, at)}
        />
    );
    return { opener, layer, cancel };
}
