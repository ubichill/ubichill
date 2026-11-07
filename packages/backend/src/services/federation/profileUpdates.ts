/**
 * このサーバーの人のプロフィールが変わったら、ほかのサーバーのフレンドに Update{Person} を届ける
 * （受けたサーバーは actor の文書を取り直す。届かなくても 1 時間で取り直される）。
 * 同じサーバーのフレンドへは、共有の inbox に 1 通だけ送る。
 */
import type { RemoteActorRecord } from '@ubichill/db';
import { buildUpdateActor } from '@ubichill/shared';
import type { LocalActors } from './documents';
import type { FederationIdentity } from './identity';
import type { Outbox } from './outbox';

export function createProfileAnnouncer(deps: {
    identity: FederationIdentity;
    localActors: Pick<LocalActors, 'person'>;
    /** フレンドの actor の id */
    friendsOf(userId: string): Promise<string[]>;
    actors: { findByIds(ids: readonly string[]): Promise<RemoteActorRecord[]> };
    outbox: Pick<Outbox, 'send'>;
}) {
    return async (userId: string): Promise<number> => {
        const doc = await deps.localActors.person(userId);
        if (!doc) return 0;
        const friends = (await deps.actors.findByIds(await deps.friendsOf(userId))).filter((a) => !a.deletedAt);
        const byInbox = [...Map.groupBy(friends, (a) => a.sharedInbox ?? a.inbox)];
        await Promise.all(
            byInbox.map(([inbox, group]) =>
                deps.outbox.send({
                    activity: buildUpdateActor({
                        id: deps.identity.newActivityId(),
                        actor: deps.identity.actorUrl(userId),
                        to: group.map((a) => a.id),
                        object: doc,
                    }),
                    from: { kind: 'user', userId },
                    to: { id: group[0]?.id ?? inbox, inbox },
                }),
            ),
        );
        return byInbox.length;
    };
}
