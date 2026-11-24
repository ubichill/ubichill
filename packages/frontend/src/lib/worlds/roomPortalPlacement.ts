/** ポータルの真ん中（ワールドの座標）。 */
export interface PortalSpot {
    x: number;
    y: number;
}

export interface RoomPortalPlacementDeps {
    /** 置く許可を backend にもらう */
    requestGrant: (room: string) => Promise<string>;
    /** インスタンスに置かせる。断られた理由を返す（置けたら null） */
    open: (room: string, at: PortalSpot, grant: string) => Promise<string | null>;
}

const FALLBACK_MESSAGE = 'ポータルを置けませんでした';

/**
 * 置く場所を選んだあとの手順。行き先を決め（新しいインスタンスはここで作る）、置く許可をもらって、選んだ所に置く。
 * 場所を選ぶ前には何もしない（やめたときに空の部屋が残らず、作成の回数制限も使わない）。置けなかった理由を返す（置けたら null）。
 */
export async function placeRoomPortal(
    deps: RoomPortalPlacementDeps,
    room: () => Promise<string>,
    at: PortalSpot,
): Promise<string | null> {
    try {
        const destination = await room();
        const grant = await deps.requestGrant(destination);
        return await deps.open(destination, at, grant);
    } catch (e) {
        return e instanceof Error && e.message ? e.message : FALLBACK_MESSAGE;
    }
}
