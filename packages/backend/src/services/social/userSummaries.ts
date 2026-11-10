/** 一覧・検索に出すユーザーの公開情報（UserSummary）を DB から引く。ほかのサーバーの人は actor のキャッシュから。 */
import { type RemoteActorRecord, remoteActorRepository, type UserRecord, userRepository } from '@ubichill/db';
import { isRemoteUserId, remoteEmojisOf, remoteStatusOf, type UserSummary } from '@ubichill/shared';

export const summaryOf = (u: UserRecord, status?: string): UserSummary => ({
    id: u.id,
    name: u.name,
    handle: u.handle,
    image: u.image ?? null,
    bio: u.bio ?? null,
    ...(status ? { status } : {}),
});

/** ほかのサーバーの人（handle は `handle@domain`、名前が無ければ handle）。 */
export const remoteSummaryOf = (a: RemoteActorRecord): UserSummary => {
    const status = remoteStatusOf(a.profile);
    const emojis = remoteEmojisOf(a.profile);
    return {
        id: a.id,
        name: a.name ?? a.account.split('@')[0] ?? a.account,
        handle: a.account,
        image: a.icon ?? null,
        bio: a.summary ?? null,
        ...(status ? { status } : {}),
        domain: a.domain,
        ...(emojis.length > 0 ? { emojis } : {}),
    };
};

/**
 * ID の順のまま返す（消えたユーザー・消えた actor は飛ばす）。ID は、このサーバーのユーザー ID か actor の URL。
 * フレンドの一覧のカードに出すので、ひとことも付ける。
 */
export async function summariesOf(ids: readonly string[]): Promise<UserSummary[]> {
    const remoteIds = ids.filter(isRemoteUserId);
    const localIds = ids.filter((id) => !isRemoteUserId(id));
    const [users, statuses, actors] = await Promise.all([
        userRepository.findByIds(localIds),
        userRepository.statusesOf(localIds),
        remoteIds.length > 0 ? remoteActorRepository.findByIds(remoteIds) : Promise.resolve([]),
    ]);
    const byId = new Map<string, UserSummary>([
        ...users.map((u): [string, UserSummary] => [u.id, summaryOf(u, statuses.get(u.id))]),
        ...actors.filter((a) => !a.deletedAt).map((a): [string, UserSummary] => [a.id, remoteSummaryOf(a)]),
    ]);
    return ids.flatMap((id) => {
        const summary = byId.get(id);
        return summary ? [summary] : [];
    });
}
