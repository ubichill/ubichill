/** ポータルの先の部屋のページ（ほかのサーバーの部屋の住所 `<ID>@<ドメイン>` もそのまま 1 つのパスにする）。 */
export const portalRoomPath = (room: string): string => `/instance/${encodeURIComponent(room)}`;
