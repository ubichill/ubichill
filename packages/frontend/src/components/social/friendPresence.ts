/**
 * フレンドの現在地の並べ方（ソーシャルとランチパッドで共有する純粋な関数）。
 */
import type { Instance, UserSummary } from '@ubichill/shared';
import type { FriendLocationsResponse, UnreachableFriend } from '@/lib/socialApi';
import { relativeTime } from '../../lib/notifications';

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
    /** ほかのサーバーにつながらず確かめられない（いないとは言わない） */
    unreachable: UnreachableFriend[];
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
    const unreachable = [...(data.unreachable ?? [])].sort((a, b) => byName(a.user, b.user));
    const onlineCount = (here?.friends.length ?? 0) + places.reduce((n, p) => n + p.friends.length, 0) + hidden.length;
    return { here, places, hidden, offline, unreachable, onlineCount };
}

/** 確かめられないフレンドの、最後に確かめた様子（「5 分前は森」）。確かめたことが無ければ undefined。 */
export function lastKnownOf(friend: UnreachableFriend, now: number): string | undefined {
    const last = friend.lastKnown;
    if (!last) return undefined;
    const where =
        last.status === 'in_room'
            ? (last.place ?? '部屋')
            : last.status === 'private'
              ? '非公開の部屋'
              : last.status === 'online'
                ? 'オンライン'
                : 'オフライン';
    return `${relativeTime(last.at, now)}は${where}`;
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

/** オンラインのフレンドのいる場所を一言で（顔の列・すべてのフレンドのカード）。 */
export function whereLabel(where: FriendWhere): string {
    switch (where.kind) {
        case 'here':
            return 'ここにいます';
        case 'room':
            return where.instance.world.displayName;
        case 'hidden':
            return 'プライベート';
    }
}

/** フレンドのカード 1 枚（顔・名前・2 行目の一言）。online は顔の右下の点。 */
export interface FriendCard {
    user: UserSummary;
    detail: string | null;
    online: boolean;
}

/** 部屋にいるフレンドのカード。部屋ごとにまとめて出すので、2 行目は場所ではなくひとこと。 */
export const placeFriendCards = (friends: readonly UserSummary[]): FriendCard[] =>
    friends.map((user) => ({ user, detail: user.status ?? null, online: true }));

export interface FriendDirectory {
    /** 名前順。2 行目はいる場所 */
    online: FriendCard[];
    /** 2 行目は最後に確かめた様子 */
    unreachable: FriendCard[];
    /** 2 行目はひとこと */
    offline: FriendCard[];
    total: number;
}

/** すべてのフレンド: オンライン → 確かめられない → オフライン。部屋でまとめないので、オンラインの人にはいる場所を添える。 */
export function friendDirectory(presence: FriendPresence, now: number): FriendDirectory {
    const online = onlineFriends(presence)
        .map(({ user, where }) => ({ user, detail: whereLabel(where), online: true }))
        .sort((a, b) => byName(a.user, b.user));
    const unreachable = presence.unreachable.map((f) => ({
        user: f.user,
        detail: lastKnownOf(f, now) ?? null,
        online: false,
    }));
    const offline = presence.offline.map((user) => ({ user, detail: user.status ?? null, online: false }));
    return { online, unreachable, offline, total: online.length + unreachable.length + offline.length };
}

/**
 * プロフィールに出す、フレンド 1 人の現在地。
 * - room: 見えて入れる部屋（自分と同じ部屋なら here）。friends はその部屋にいるフレンド（本人を含む）
 * - private: 見えない部屋・招待が要る部屋・場所を見せない設定（どこかは出さない）
 * - unreachable: 相手のサーバーにつながらず確かめられない（いないとは言わない）
 * - offline: 部屋にいない
 * - unknown: 一覧に無い（フレンドになったばかりなど。何も出さない）
 */
export type FriendLocation =
    | { kind: 'room'; instance: Instance; friends: UserSummary[]; here: boolean }
    | { kind: 'private' }
    | { kind: 'unreachable'; lastKnown?: string }
    | { kind: 'offline' }
    | { kind: 'unknown' };

export function friendLocationOf(
    data: FriendLocationsResponse,
    userId: string,
    currentInstanceId: string | undefined,
    now: number,
): FriendLocation {
    const place = data.locations.find((l) => l.friends.some((f) => f.id === userId));
    if (place) {
        const here = place.instance.id === currentInstanceId;
        // 入れない部屋はどこかを出さない（自分もいる部屋なら入れているので出す）
        if (!here && place.instance.canJoin === false) return { kind: 'private' };
        return { kind: 'room', instance: place.instance, friends: [...place.friends].sort(byName), here };
    }
    if (data.private.some((f) => f.id === userId)) return { kind: 'private' };
    const unreachable = data.unreachable?.find((f) => f.user.id === userId);
    if (unreachable) return { kind: 'unreachable', lastKnown: lastKnownOf(unreachable, now) };
    if (data.elsewhere.some((f) => f.id === userId)) return { kind: 'offline' };
    return { kind: 'unknown' };
}

/**
 * 招待が要る部屋に入れてもらうよう頼む相手。作成者がフレンドなら作成者（どの公開範囲でも招待できる）、
 * そうでなければその部屋にいるフレンドの最初の人。フレンドがいなければ undefined。
 */
export function requestTargetOf(place: FriendPlace): UserSummary | undefined {
    return place.friends.find((f) => f.id === place.instance.leaderId) ?? place.friends[0];
}
