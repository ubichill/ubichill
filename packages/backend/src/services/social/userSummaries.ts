/** 一覧・検索に出すユーザーの公開情報（UserSummary）を DB から引く。ほかのサーバーの人は actor のキャッシュから。 */
import { type RemoteActorRecord, remoteActorRepository, type UserRecord, userRepository } from '@ubichill/db';
import { isRemoteUserId, type UserSummary } from '@ubichill/shared';

export const summaryOf = (u: UserRecord): UserSummary => ({
    id: u.id,
    name: u.name,
    handle: u.handle,
    image: u.image ?? null,
    bio: u.bio ?? null,
});

/** ほかのサーバーの人（handle は `handle@domain`、名前が無ければ handle）。 */
export const remoteSummaryOf = (a: RemoteActorRecord): UserSummary => ({
    id: a.id,
    name: a.name ?? a.account.split('@')[0] ?? a.account,
    handle: a.account,
    image: a.icon ?? null,
    bio: a.summary ?? null,
    domain: a.domain,
});

/** ID の順のまま返す（消えたユーザー・消えた actor は飛ばす）。ID は、このサーバーのユーザー ID か actor の URL。 */
export async function summariesOf(ids: readonly string[]): Promise<UserSummary[]> {
    const remoteIds = ids.filter(isRemoteUserId);
    const localIds = ids.filter((id) => !isRemoteUserId(id));
    const [users, actors] = await Promise.all([
        userRepository.findByIds(localIds),
        remoteIds.length > 0 ? remoteActorRepository.findByIds(remoteIds) : Promise.resolve([]),
    ]);
    const byId = new Map<string, UserSummary>([
        ...users.map((u): [string, UserSummary] => [u.id, summaryOf(u)]),
        ...actors.filter((a) => !a.deletedAt).map((a): [string, UserSummary] => [a.id, remoteSummaryOf(a)]),
    ]);
    return ids.flatMap((id) => {
        const summary = byId.get(id);
        return summary ? [summary] : [];
    });
}
