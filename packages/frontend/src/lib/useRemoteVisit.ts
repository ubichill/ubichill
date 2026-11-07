import { FEDERATION_LIMITS } from '@ubichill/shared';
import { useEffect } from 'react';
import { endVisit, isRemoteRoomAddress, keepVisiting } from './instancesApi';

/**
 * ほかのサーバーの部屋にいる間、ホームに来訪を知らせ続ける（フレンドの現在地に出るため）。部屋を出たら来訪をやめる。
 * 来訪の記録は入室のときにホームが作るので、ここは続けるだけ。
 */
export function useRemoteVisit(instanceId: string | undefined, joined: boolean): void {
    useEffect(() => {
        if (!instanceId || !joined || !isRemoteRoomAddress(instanceId)) return;
        const timer = setInterval(
            () => void keepVisiting(instanceId).catch(() => undefined),
            FEDERATION_LIMITS.VISIT_HEARTBEAT_MS,
        );
        return () => {
            clearInterval(timer);
            endVisit(instanceId);
        };
    }, [instanceId, joined]);
}
