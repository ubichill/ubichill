import type { FediverseOverview } from '@ubichill/shared';

/**
 * フォロワーの操作を、手元の一覧に反映する（取り直しを待たずに見た目を変える）。
 * - approve: 承認待ち → フォロワーの先頭へ（数も 1 増やす）
 * - reject: 承認待ち・フォロワーのどちらからも外す（フォロワーだったなら数を 1 減らす）
 */
export function withFollowerAnswered(
    overview: FediverseOverview,
    actorId: string,
    action: 'approve' | 'reject',
): FediverseOverview {
    const pending = overview.pending.filter((f) => f.actorId !== actorId);
    const approved = overview.pending.find((f) => f.actorId === actorId);
    if (action === 'approve') {
        if (!approved) return overview;
        return {
            ...overview,
            pending,
            followers: [{ ...approved, state: 'accepted' }, ...overview.followers],
            followerCount: overview.followerCount + 1,
        };
    }
    const wasFollower = overview.followers.some((f) => f.actorId === actorId);
    return {
        ...overview,
        pending,
        followers: overview.followers.filter((f) => f.actorId !== actorId),
        followerCount: Math.max(0, overview.followerCount - (wasFollower ? 1 : 0)),
    };
}
