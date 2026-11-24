import { ROOM_PORTAL } from '@ubichill/shared';
import { TimedOutError, withinTime } from './roomPortalEntry';

/** ポータルの真ん中（ワールドの座標）。 */
export interface PortalSpot {
    x: number;
    y: number;
}

export interface RoomPortalPlacementDeps {
    /** 置く許可を backend にもらう */
    requestGrant: (room: string, signal: AbortSignal) => Promise<string>;
    /** インスタンスに置かせる。断られた理由を返す（置けたら null） */
    open: (room: string, at: PortalSpot, grant: string) => Promise<string | null>;
}

/** 部屋を作る・許可をもらうのを待つ上限（ms）。止まった backend で画面が止まり続けないように。 */
export const PORTAL_REQUEST_TIMEOUT_MS = 15_000;

/** インスタンスの「少し待ってから置き直してください」と同じ文。 */
export const PORTAL_COOLDOWN_MESSAGE = '少し待ってから置き直してください';

const TIMEOUT_MESSAGE = '応答が無いため、ポータルを置けませんでした';
const FALLBACK_MESSAGE = 'ポータルを置けませんでした';

/**
 * 置く場所を選んだあとの手順。行き先を決め（新しいインスタンスはここで作る）、置く許可をもらって、選んだ所に置く。
 * 場所を選ぶ前には何もしない（やめたときに空の部屋が残らず、作成の回数制限も使わない）。
 * 置けなかった理由を返す。置けた・signal で取りやめたら null（取りやめたあとは置かない）。
 */
export async function placeRoomPortal(
    deps: RoomPortalPlacementDeps,
    room: (signal: AbortSignal) => Promise<string>,
    at: PortalSpot,
    signal: AbortSignal,
    timeoutMs: number = PORTAL_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
    try {
        const destination = await withinTime(room, timeoutMs, signal);
        const grant = await withinTime((s) => deps.requestGrant(destination, s), timeoutMs, signal);
        if (signal.aborted) return null;
        return await deps.open(destination, at, grant);
    } catch (e) {
        if (signal.aborted) return null;
        if (e instanceof TimedOutError) return TIMEOUT_MESSAGE;
        return e instanceof Error && e.message ? e.message : FALLBACK_MESSAGE;
    }
}

/** 前に置けた時刻から、置き直せるまでの残り（ms）。0 なら置ける。インスタンスに断られる部屋を先に作らないために見る。 */
export function portalCooldownRemaining(lastPlacedAt: number | null, now: number): number {
    if (lastPlacedAt === null) return 0;
    // 時計が戻っても、間隔より長くは待たせない
    return Math.min(ROOM_PORTAL.COOLDOWN_MS, Math.max(0, lastPlacedAt + ROOM_PORTAL.COOLDOWN_MS - now));
}
