/** 一覧・検索に出すユーザーの公開情報（UserSummary）を DB から引く。 */
import { type UserRecord, userRepository } from '@ubichill/db';
import type { UserSummary } from '@ubichill/shared';

export const summaryOf = (u: UserRecord): UserSummary => ({
    id: u.id,
    name: u.name,
    handle: u.handle,
    image: u.image ?? null,
    bio: u.bio ?? null,
});

/** ID の順のまま返す（消えたユーザーは飛ばす）。 */
export async function summariesOf(ids: readonly string[]): Promise<UserSummary[]> {
    const users = await userRepository.findByIds(ids);
    const byId = new Map(users.map((u) => [u.id, u]));
    return ids.flatMap((id) => {
        const u = byId.get(id);
        return u ? [summaryOf(u)] : [];
    });
}
