/**
 * 部屋の住所。このサーバーの部屋は ID だけ、ほかのサーバーの部屋は `<部屋の ID>@<ドメイン>`（アカウントの `handle@domain` と同じ形）。
 * 画面の URL（`/instance/:住所`）・招待の通知・フレンドの現在地で同じ形を使い、どのサーバーの部屋でも同じ流れで入れる。
 */
import { isServerDomain } from '../../user/handle';

/** 部屋の ID（nanoid・UUID）。`@` を含まないので住所と取り違えない。 */
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface RoomAddress {
    id: string;
    /** ほかのサーバーの部屋ならそのドメイン。このサーバーの部屋なら null */
    domain: string | null;
}

/** 住所を分解する。自分のドメインを付けた住所はこのサーバーの部屋として扱う。不正なら null。 */
export function parseRoomAddress(input: string, selfDomain: string): RoomAddress | null {
    const at = input.lastIndexOf('@');
    const id = at < 0 ? input : input.slice(0, at);
    if (!ROOM_ID_PATTERN.test(id)) return null;
    if (at < 0) return { id, domain: null };
    const domain = input.slice(at + 1).toLowerCase();
    if (!isServerDomain(domain)) return null;
    return { id, domain: domain === selfDomain.toLowerCase() ? null : domain };
}

/** 住所の表記（このサーバーの部屋は ID だけ）。 */
export function formatRoomAddress({ id, domain }: RoomAddress): string {
    return domain ? `${id}@${domain}` : id;
}

/** 部屋のサーバーでの部屋の ID（住所の `@` より前）。部屋のサーバーへの入室（WebSocket）はこの ID で行う。 */
export function roomIdOf(address: string): string {
    const at = address.lastIndexOf('@');
    return at < 0 ? address : address.slice(0, at);
}

/** ほかのサーバーの部屋か。 */
export const isRemoteRoom = (address: RoomAddress): address is RoomAddress & { domain: string } =>
    address.domain !== null;
