import {
    canOpenRoomPortalTo,
    isRoomPortalAddress,
    parseRoomAddress,
    ROOM_PORTAL_GRANT,
    type RoomPortalGrantClaims,
    type WorldVisibility,
} from '@ubichill/shared';

export const PRIVATE_ROOM_PORTAL_MESSAGE = 'プライベートのワールドの部屋へのポータルは、部屋を作った人だけが置けます';

export interface RoomPortalGrantDeps {
    /** このサーバーのドメイン（`<ID>@<このドメイン>` はこのサーバーの部屋） */
    selfDomain: () => string;
    findRoom: (id: string) => Promise<{ leaderId: string; worldRef: string } | undefined>;
    /** ワールドをいま解決する（部屋を作った時の公開範囲ではなく、いまの公開範囲を見る） */
    resolveWorld: (ref: string) => Promise<{ ok: true; world: { visibility?: WorldVisibility } } | { ok: false }>;
    sign: (claims: RoomPortalGrantClaims) => string;
    now: () => number;
}

export type RoomPortalGrantOutcome =
    | { ok: true; grant: string }
    | { ok: false; status: 400 | 403 | 404; error: string };

export interface RoomPortalGrants {
    /** userId が今の部屋に、room（`portal:open` に送るのと同じ文字列）へのポータルを置く許可を出す。 */
    issue(userId: string, room: string): Promise<RoomPortalGrantOutcome>;
}

/**
 * 部屋へのポータルを置く許可。インスタンス（Go）は行き先の書式しか分からないので、プライベートのワールドの部屋へは
 * その部屋を作った人だけが置ける、という判定をここで行い、Go は許可の署名だけを確かめる。
 * ほかのサーバーの部屋は許可する（入れる人は部屋のサーバーが決める）。ワールドを確かめられなければプライベートとして扱う。
 */
export function createRoomPortalGrants(deps: RoomPortalGrantDeps): RoomPortalGrants {
    /** このサーバーの部屋へ置けないわけ。置けるなら null。部屋を作った人はワールドを引かずに置ける */
    const refusal = async (userId: string, id: string): Promise<RoomPortalGrantOutcome | null> => {
        const room = await deps.findRoom(id);
        if (!room) return { ok: false, status: 404, error: 'インスタンスが見つかりません' };
        if (room.leaderId === userId) return null;
        const resolution = await deps.resolveWorld(room.worldRef);
        const visibility: WorldVisibility = resolution.ok ? (resolution.world.visibility ?? 'public') : 'private';
        return canOpenRoomPortalTo({ leaderId: room.leaderId, world: { visibility } }, userId)
            ? null
            : { ok: false, status: 403, error: PRIVATE_ROOM_PORTAL_MESSAGE };
    };
    return {
        async issue(userId, room) {
            const address = isRoomPortalAddress(room) ? parseRoomAddress(room, deps.selfDomain()) : null;
            if (!address) return { ok: false, status: 400, error: '行き先の部屋が正しくありません' };
            const refused = address.domain === null ? await refusal(userId, address.id) : null;
            if (refused) return refused;
            const exp = Math.floor(deps.now() / 1000) + ROOM_PORTAL_GRANT.TTL_SECONDS;
            return { ok: true, grant: deps.sign({ room, userId, exp }) };
        },
    };
}
