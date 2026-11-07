/**
 * フレンドの現在地の並べ方（ソーシャルとランチパッドで共有する純粋な関数）。
 */
import type { Instance, UserSummary } from '@ubichill/shared';
import type { FriendLocationsResponse } from '@/lib/socialApi';

export interface FriendPlace {
    instance: Instance;
    friends: UserSummary[];
}

export interface FriendPresence {
    /** 自分がいる部屋（公開範囲に関係なく出す）と、そこにいるフレンド */
    here: FriendPlace | null;
    /** ほかの部屋。フレンドの多い順、同じなら人の多い順 */
    places: FriendPlace[];
    /** 自分に見えない部屋にいるフレンド（どこかは出さない） */
    hidden: UserSummary[];
    offline: UserSummary[];
    onlineCount: number;
}

export type FriendWhere = { kind: 'here' } | { kind: 'room'; instance: Instance } | { kind: 'hidden' };

const byName = (a: UserSummary, b: UserSummary) => a.name.localeCompare(b.name, 'ja');

export function arrangeFriendPresence(data: FriendLocationsResponse, current: Instance | null): FriendPresence {
    const mine = current ? data.locations.find((l) => l.instance.id === current.id) : undefined;
    const here = current
        ? { instance: mine?.instance ?? current, friends: [...(mine?.friends ?? [])].sort(byName) }
        : null;
    const places = data.locations
        .filter((l) => l.instance.id !== current?.id && l.friends.length > 0)
        .map((l) => ({ instance: l.instance, friends: [...l.friends].sort(byName) }))
        .sort(
            (a, b) =>
                b.friends.length - a.friends.length ||
                b.instance.stats.currentUsers - a.instance.stats.currentUsers ||
                a.instance.world.displayName.localeCompare(b.instance.world.displayName, 'ja'),
        );
    const hidden = [...data.private].sort(byName);
    const offline = [...data.elsewhere].sort(byName);
    const onlineCount = (here?.friends.length ?? 0) + places.reduce((n, p) => n + p.friends.length, 0) + hidden.length;
    return { here, places, hidden, offline, onlineCount };
}

/** オンラインのフレンドを 1 列に（同じ部屋 → ほかの部屋 → 見えない部屋）。ランチパッドの顔の列に使う。 */
export function onlineFriends(presence: FriendPresence): Array<{ user: UserSummary; where: FriendWhere }> {
    return [
        ...(presence.here?.friends ?? []).map((user) => ({ user, where: { kind: 'here' } as const })),
        ...presence.places.flatMap((p) =>
            p.friends.map((user) => ({ user, where: { kind: 'room', instance: p.instance } as const })),
        ),
        ...presence.hidden.map((user) => ({ user, where: { kind: 'hidden' } as const })),
    ];
}

/**
 * 招待が要る部屋に入れてもらうよう頼む相手。作成者がフレンドなら作成者（どの公開範囲でも招待できる）、
 * そうでなければその部屋にいるフレンドの最初の人。フレンドがいなければ undefined。
 */
export function requestTargetOf(place: FriendPlace): UserSummary | undefined {
    return place.friends.find((f) => f.id === place.instance.leaderId) ?? place.friends[0];
}
