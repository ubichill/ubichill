/** このサーバーの actor の文書（Person・Application）。鍵は種から導いた公開鍵を載せる。 */
import { buildActorDocument, FEDERATION_FEATURES } from '@ubichill/shared';
import type { FederationIdentity } from './identity';
import type { Keyring } from './keys';

export interface LocalUser {
    id: string;
    handle: string;
    name: string;
    bio: string | null;
    image: string | null;
}

export function createLocalActors(deps: {
    identity: FederationIdentity;
    keyring: Keyring;
    findUser(userId: string): Promise<LocalUser | undefined>;
    /** プロフィールの画面のオリジン（本番は同じオリジン） */
    profileOrigin: string;
}) {
    const absolute = (url: string | null) => (url ? new URL(url, deps.identity.origin).href : null);
    return {
        async person(userId: string): Promise<Record<string, unknown> | undefined> {
            const user = await deps.findUser(userId);
            if (!user) return undefined;
            const id = deps.identity.actorUrl(user.id);
            const signer = deps.keyring.signerFor(id);
            return buildActorDocument({
                id,
                type: 'Person',
                preferredUsername: user.handle,
                name: user.name,
                summary: user.bio,
                url: `${deps.profileOrigin}/@${user.handle}`,
                icon: absolute(user.image),
                inbox: deps.identity.userInboxUrl(user.id),
                outbox: deps.identity.outboxUrl(user.id),
                sharedInbox: deps.identity.sharedInboxUrl,
                keyId: signer.keyId,
                publicKeyMultibase: signer.publicKeyMultibase,
                webfinger: `${user.handle}@${deps.identity.domain}`,
            });
        },

        application(): Record<string, unknown> {
            const id = deps.identity.appActorUrl;
            const signer = deps.keyring.signerFor(id);
            return buildActorDocument({
                id,
                type: 'Application',
                preferredUsername: deps.identity.domain,
                name: 'ubichill',
                url: deps.profileOrigin,
                inbox: deps.identity.sharedInboxUrl,
                sharedInbox: deps.identity.sharedInboxUrl,
                keyId: signer.keyId,
                publicKeyMultibase: signer.publicKeyMultibase,
                implements: Object.values(FEDERATION_FEATURES),
            });
        },
    };
}

export type LocalActors = ReturnType<typeof createLocalActors>;
