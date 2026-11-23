/** ポータルの先の部屋のページ（ほかのサーバーの部屋の住所 `<ID>@<ドメイン>` もそのまま 1 つのパスにする）。 */
export const portalRoomPath = (room: string): string => `/instance/${encodeURIComponent(room)}`;

/**
 * 入ったページの部屋の ID を、このサーバーの部屋の ID にそろえるか。自分のドメインを付けた住所（`<ID>@<このサーバー>`。
 * ほかのサーバーの部屋に置かれたポータルの行き先など）で来ると、backend はこのサーバーの部屋として答えるが、ページの ID の
 * ままだと招待・来訪の知らせが別の部屋として扱う。引いた部屋の ID が @ を含まず（このサーバーの部屋）ページの ID と違えば、
 * その ID。そろえなくてよければ null（ほかのサーバーの部屋は住所のまま）。
 */
export function canonicalRoomId(pageId: string, fetchedId: string): string | null {
    return fetchedId !== pageId && !fetchedId.includes('@') && fetchedId.length > 0 ? fetchedId : null;
}
