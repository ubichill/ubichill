/**
 * ほかのサーバーの部屋ごとの、そこにいるフレンド（現在地で見たもの）。部屋の作りの取得と入室で「会いに行く人」として渡す。
 * 部屋のサーバーはこの人たちとの関係から先に確かめる（中にいる人が多くても、現在地で「入れる」と出た部屋に入れるように）。
 */

/** 1 回に渡す数（部屋のサーバーが尋ねる上限と同じ） */
const MAX_VIA = 10;

interface Located {
    instance: { id: string };
    friends: ReadonlyArray<{ id: string }>;
}

/** 現在地の一覧から、ほかのサーバーの部屋ごとのフレンドの ID を作る。 */
export function friendsByRemoteRoom(locations: readonly Located[]): Map<string, string[]> {
    return new Map(
        locations
            // ほかのサーバーの部屋の住所は `<部屋の ID>@<ドメイン>`（instancesApi の isRemoteRoomAddress と同じ）
            .filter((l) => l.instance.id.includes('@') && l.friends.length > 0)
            .map((l) => [l.instance.id, l.friends.slice(0, MAX_VIA).map((f) => f.id)]),
    );
}

const latest = { byRoom: new Map<string, string[]>() };

/** 現在地を読み直したら置き換える（前に見た部屋の古いフレンドは残さない）。 */
export function rememberFriendLocations(locations: readonly Located[]): void {
    latest.byRoom = friendsByRemoteRoom(locations);
}

/** その部屋に会いに行くフレンド（知らなければ空）。 */
export function viaOf(instanceId: string): string[] {
    return latest.byRoom.get(instanceId) ?? [];
}
