/**
 * このサーバーの人のプロフィール（フェディバースの設定を含む）が変わったら、ほかのサーバーのフレンドとフォロワーに
 * Update{Person} を届ける（受けたサーバーは actor の文書を取り直す。届かなくても 1 時間で取り直される）。
 * 同じサーバーの相手へは、共有の inbox に 1 通だけ送る。
 */
import type { RemoteActorRecord } from '@ubichill/db';
import { buildUpdateActor } from '@ubichill/shared';
import type { FederationIdentity } from '../identity';
import type { LocalActors } from './documents';
import type { Outbox } from './outbox';

export function createProfileAnnouncer(deps: {
    identity: FederationIdentity;
    localActors: Pick<LocalActors, 'person'>;
    /** 知らせる相手（フレンドとフォロワー）の actor の id */
    audienceOf(userId: string): Promise<string[]>;
    actors: { findByIds(ids: readonly string[]): Promise<RemoteActorRecord[]> };
    outbox: Pick<Outbox, 'send'>;
}) {
    return async (userId: string): Promise<number> => {
        const doc = await deps.localActors.person(userId);
        if (!doc) return 0;
        const audience = (await deps.actors.findByIds(await deps.audienceOf(userId))).filter((a) => !a.deletedAt);
        const byInbox = [...Map.groupBy(audience, (a) => a.sharedInbox ?? a.inbox)];
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
