/**
 * このサーバーの連合の URL（actor・inbox・部屋・activity の id）。id は作ったら変えない（ほかのサーバーが持つ）。
 */
import { FEDERATION_PATHS, formatRoomAddress, hostOf, type RoomAddress } from '@ubichill/shared';
import { nanoid } from 'nanoid';

export interface FederationIdentity {
    origin: string;
    domain: string;
    actorUrl(userId: string): string;
    appActorUrl: string;
    userInboxUrl(userId: string): string;
    sharedInboxUrl: string;
    outboxUrl(userId: string): string;
    instanceUrl(instanceId: string): string;
    newActivityId(): string;
    newRelationshipId(): string;
    /** このサーバーのユーザーの actor の URL なら、そのユーザーの ID */
    localUserIdOf(actorUrl: string): string | null;
    /** このサーバーの部屋の URL なら、その部屋の ID */
    localInstanceIdOf(roomUrl: string): string | null;
    /** 部屋の URL → 画面の住所（`<部屋の ID>@<ドメイン>`。このサーバーの部屋は ID だけ） */
    roomAddressOf(roomUrl: string): string | null;
    /** 画面の住所 → 部屋の URL */
    roomUrlOf(address: RoomAddress, scheme: 'https' | 'http'): string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createFederationIdentity(origin: string): FederationIdentity {
    const domain = (hostOf(origin) ?? '').toLowerCase();
    const pathId = (url: string, prefix: string): string | null => {
        if (!url.startsWith(`${origin}${prefix}`)) return null;
        const rest = decodeURIComponent(url.slice(origin.length + prefix.length));
        return ID.test(rest) ? rest : null;
    };
    return {
        origin,
        domain,
        actorUrl: (userId) => `${origin}${FEDERATION_PATHS.user(userId)}`,
        appActorUrl: `${origin}${FEDERATION_PATHS.appActor}`,
        userInboxUrl: (userId) => `${origin}${FEDERATION_PATHS.userInbox(userId)}`,
        sharedInboxUrl: `${origin}${FEDERATION_PATHS.sharedInbox}`,
        outboxUrl: (userId) => `${origin}${FEDERATION_PATHS.userOutbox(userId)}`,
        instanceUrl: (instanceId) => `${origin}${FEDERATION_PATHS.instance(instanceId)}`,
        newActivityId: () => `${origin}${FEDERATION_PATHS.activity(nanoid())}`,
        newRelationshipId: () => `${origin}${FEDERATION_PATHS.friendship(nanoid())}`,
        localUserIdOf: (url) => pathId(url, '/ap/users/'),
        localInstanceIdOf: (url) => pathId(url, '/ap/instances/'),
        roomAddressOf(roomUrl) {
            const host = hostOf(roomUrl);
            const marker = '/ap/instances/';
            const at = roomUrl.indexOf(marker);
            if (!host || at < 0) return null;
            const id = decodeURIComponent(roomUrl.slice(at + marker.length));
            if (!ID.test(id)) return null;
            return formatRoomAddress({ id, domain: host === domain ? null : host });
        },
        roomUrlOf(address, scheme) {
            return address.domain
                ? `${scheme}://${address.domain}${FEDERATION_PATHS.instance(address.id)}`
                : `${origin}${FEDERATION_PATHS.instance(address.id)}`;
        },
    };
}
