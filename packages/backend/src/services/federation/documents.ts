/**
 * このサーバーの actor の文書（Person・Application）。Ed25519 は種から導いた公開鍵、RSA は保存した鍵（ほかの実装向け）を載せる。
 * フォロワー・フォローのコレクションは件数だけ公開する（誰がフォローしているかは出さない）。
 */
import { AS_CONTEXT, buildActorDocument, FEDERATION_FEATURES, type FediverseSettings } from '@ubichill/shared';
import type { FederationIdentity } from './identity';
import type { Keyring } from './keys';
import type { RsaKeyring } from './rsaKeys';

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
    rsaKeys: RsaKeyring;
    findUser(userId: string): Promise<LocalUser | undefined>;
    settingsOf(userId: string): Promise<FediverseSettings>;
    followerCount(userId: string): Promise<number>;
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
            const [rsa, settings] = await Promise.all([deps.rsaKeys.signerFor(id, user.id), deps.settingsOf(user.id)]);
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
                followers: deps.identity.followersUrl(user.id),
                following: deps.identity.followingUrl(user.id),
                sharedInbox: deps.identity.sharedInboxUrl,
                keyId: signer.keyId,
                publicKeyMultibase: signer.publicKeyMultibase,
                previousKeys: deps.keyring.previousKeysFor(id),
                rsaKey: { keyId: rsa.keyId, publicKeyPem: rsa.publicKeyPem },
                manuallyApprovesFollowers: settings.manuallyApprovesFollowers,
                discoverable: settings.discoverable,
                webfinger: `${user.handle}@${deps.identity.domain}`,
            });
        },

        async application(): Promise<Record<string, unknown>> {
            const id = deps.identity.appActorUrl;
            const signer = deps.keyring.signerFor(id);
            const rsa = await deps.rsaKeys.signerFor(id, null);
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
                previousKeys: deps.keyring.previousKeysFor(id),
                rsaKey: { keyId: rsa.keyId, publicKeyPem: rsa.publicKeyPem },
                discoverable: false,
                implements: Object.values(FEDERATION_FEATURES),
            });
        },

        /** フォロワー・フォローのコレクション（件数だけ。ユーザーがいなければ undefined）。 */
        async collection(
            userId: string,
            kind: 'followers' | 'following',
        ): Promise<Record<string, unknown> | undefined> {
            const user = await deps.findUser(userId);
            if (!user) return undefined;
            return {
                '@context': AS_CONTEXT,
                id: kind === 'followers' ? deps.identity.followersUrl(user.id) : deps.identity.followingUrl(user.id),
                type: 'OrderedCollection',
                // フォローは ubichill からはしない（フレンドは別の関係）
                totalItems: kind === 'followers' ? await deps.followerCount(user.id) : 0,
            };
        },
    };
}

export type LocalActors = ReturnType<typeof createLocalActors>;
