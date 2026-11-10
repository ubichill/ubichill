/**
 * フレンドの現在地。インスタンスごとにまとめ、フレンドの多い順。
 * - 自分に見えないインスタンス（フレンドのみ・招待のみなど）にいるフレンドは、どこにいるかを出さず `private` にまとめる
 * - インスタンスにいないフレンドは `elsewhere`（オフラインかロビー）
 * - ほかのサーバーにつながらず確かめられないフレンドは `unreachable`（最後に確かめた場所と時刻を添える。いないとは言わない）
 * 規則は shared の groupFriendLocations・canSeeInstance と、本人の見せ方（presence）。
 */
import { instanceRepository, userSettingsRepository } from '@ubichill/db';
import {
    canSeeInstance,
    DEFAULT_PRESENCE_VISIBILITY,
    groupFriendLocations,
    type Instance,
    isRemoteUserId,
    type PresenceVisibility,
    type UserSummary,
} from '@ubichill/shared';
import { logger } from '../../utils/logger';
import { federation } from '../federation';
import { type FriendPresence, limitFriendPresence, visitorVisibility } from '../federation/ubichill/presence';
import { remoteInstanceOf } from '../federation/ubichill/remoteInstance';
import { instanceManager } from '../instances/instanceManager';
import { instanceRuntime } from '../instances/instanceRuntime';
import { friendIdsOf } from './friends';
import { summariesOf } from './userSummaries';

export async function friendLocationsOf(me: string) {
    const friendIds = [...(await friendIdsOf(me))];
    const myFriends = new Set(friendIds);
    // このサーバーのフレンドの見せ方（ほかのサーバーのフレンドは、そのホームが本人の設定で答える）
    const visibilities = await userSettingsRepository.presenceVisibilityOf(
        friendIds.filter((id) => !isRemoteUserId(id)),
    );
    const presence = await instanceRuntime.presence();
    const locationsByUser = new Map(
        [...presence.values()].flatMap((room) => room.memberIds.map((id) => [id, room.id] as const)),
    );
    // ここに来訪しているほかのサーバーのフレンドは、本人の見せ方をホームに確かめる（同じ部屋にいる人には見えているので尋ねない）
    const visitors = await visitorVisibilities(
        me,
        friendIds.filter(
            (id) =>
                isRemoteUserId(id) && locationsByUser.has(id) && locationsByUser.get(id) !== locationsByUser.get(me),
        ),
    );
    const visibilityOf = (id: string): PresenceVisibility =>
        isRemoteUserId(id) ? (visitors.get(id) ?? 'location') : (visibilities.get(id) ?? DEFAULT_PRESENCE_VISIBILITY);
    const hiddenIds = friendIds.filter((id) => visibilityOf(id) === 'hidden');
    const shownIds = friendIds.filter((id) => visibilityOf(id) !== 'hidden');
    const instanceIds = [...new Set(shownIds.flatMap((id) => locationsByUser.get(id) ?? []))];
    const records = (await Promise.all(instanceIds.map((id) => instanceRepository.findById(id)))).flatMap((r) =>
        r ? [r] : [],
    );
    const recordById = new Map(records.map((r) => [r.id, r]));
    const grouped = groupFriendLocations(
        shownIds,
        (userId) => recordById.get(locationsByUser.get(userId) ?? ''),
        (record, friendId) =>
            visibilityOf(friendId) === 'location' &&
            canSeeInstance(instanceManager.audienceOf(record, presence), me, myFriends),
    );
    const instances = (
        await Promise.all(grouped.locations.map((l) => instanceManager.getInstance(l.instance.id)))
    ).flatMap((i) => (i ? [i] : []));
    // 招待のみの部屋は見えても入れない（画面は「入る」ではなく「リクエスト」を出す）
    const withAccess = new Map(
        (await instanceManager.withViewerAccess(instances, me, myFriends, presence)).map((i) => [i.id, i]),
    );
    const localRooms = grouped.locations.flatMap((l) => {
        const instance = withAccess.get(l.instance.id);
        return instance ? [{ instance, friendIds: l.friendIds }] : [];
    });
    // このサーバーの部屋の外にいるフレンド: ほかのサーバーのフレンドはそのホームに、来訪中のフレンドは部屋のサーバーに尋ねる
    const remote = await remoteLocations(me, grouped.elsewhereIds, visibilityOf);
    const rooms = [...localRooms, ...remote.rooms];
    const privateIds = [...grouped.privateFriendIds, ...remote.privateIds];
    const elsewhere = [...grouped.elsewhereIds.filter((id) => !remote.placed.has(id)), ...hiddenIds];
    // ユーザーの情報は 1 回でまとめて引く（部屋ごとに引くと、部屋の数だけ DB に問い合わせる）
    const users = new Map(
        (
            await summariesOf([
                ...new Set([
                    ...rooms.flatMap((r) => r.friendIds),
                    ...privateIds,
                    ...elsewhere,
                    ...remote.unreachable.map((f) => f.friendId),
                ]),
            ])
        ).map((u) => [u.id, u]),
    );
    const pick = (ids: readonly string[]) => ids.flatMap((id) => users.get(id) ?? []);
    return {
        locations: rooms
            .map((r) => ({ instance: r.instance, friends: pick(r.friendIds) }))
            .sort((a, b) => b.friends.length - a.friends.length),
        private: pick(privateIds),
        elsewhere: pick(elsewhere),
        unreachable: unreachableOf(remote.unreachable, users),
    };
}

/**
 * ここに来訪しているほかのサーバーのフレンドの見せ方（ホームの答えから）。尋ねられないとき（連合なし・失敗）は場所を伏せる。
 */
async function visitorVisibilities(
    me: string,
    visitorIds: readonly string[],
): Promise<Map<string, PresenceVisibility>> {
    if (visitorIds.length === 0) return new Map();
    const answers = federation
        ? await federation.presence.locate(me, { remote: visitorIds, localVisiting: [] }).catch((error: unknown) => {
              logger.warn('[federation] 来訪中のフレンドの見せ方を確かめられません:', error);
              return [];
          })
        : [];
    const byId = new Map(answers.map((a) => [a.friendId, a]));
    return new Map(visitorIds.map((id) => [id, visitorVisibility(byId.get(id))]));
}

/** 確かめられなかったフレンドと、最後に確かめた場所（ワールドの名前）と時刻。 */
function unreachableOf(found: readonly FriendPresence[], users: ReadonlyMap<string, UserSummary>) {
    return found.flatMap((f) => {
        const user = users.get(f.friendId);
        if (!user) return [];
        const last = f.lastKnown;
        return [
            {
                user,
                ...(last
                    ? {
                          lastKnown: {
                              at: new Date(last.at).toISOString(),
                              status: last.status,
                              ...(last.room ? { place: last.room.world.name } : {}),
                          },
                      }
                    : {}),
            },
        ];
    });
}

/** このサーバーの部屋の外にいるフレンドの現在地（連合）。尋ねられなかった人は elsewhere のまま。 */
async function remoteLocations(
    me: string,
    elsewhereIds: readonly string[],
    visibilityOf: (friendId: string) => PresenceVisibility,
) {
    const empty = {
        rooms: [] as Array<{ instance: Instance; friendIds: string[] }>,
        privateIds: [] as string[],
        unreachable: [] as FriendPresence[],
        placed: new Set<string>(),
    };
    if (!federation || elsewhereIds.length === 0) return empty;
    const found = await federation.presence
        .locate(me, {
            remote: elsewhereIds.filter(isRemoteUserId),
            localVisiting: elsewhereIds.filter((id) => !isRemoteUserId(id)),
        })
        .then((all) => all.map((f) => limitFriendPresence(f, visibilityOf(f.friendId))))
        .catch((error: unknown) => {
            logger.warn('[federation] フレンドの現在地を尋ねられません:', error);
            return [];
        });
    const inRooms = found.filter((f) => f.status === 'in_room' && f.room);
    const byRoom = Map.groupBy(inRooms, (f) => f.room?.id ?? '');
    const seenAt = new Date();
    const rooms = [...byRoom.values()].flatMap((group) => {
        const room = group[0]?.room;
        const address = room && federation?.identity.roomAddressOf(room.id);
        const domain = room && new URL(room.id).host;
        // このサーバーの部屋は、このサーバーの在室で出している
        if (!room || !address || !domain || domain === federation?.identity.domain) return [];
        const instance = remoteInstanceOf(room, {
            address,
            domain,
            canJoin: group.some((f) => f.joinable),
            seenAt,
        });
        return [{ instance, friendIds: group.map((f) => f.friendId) }];
    });
    const privateIds = found.filter((f) => f.status === 'private').map((f) => f.friendId);
    const unreachable = found.filter((f) => f.status === 'unreachable');
    return {
        rooms,
        privateIds,
        unreachable,
        placed: new Set(
            [...inRooms, ...found.filter((f) => f.status === 'private'), ...unreachable].map((f) => f.friendId),
        ),
    };
}
