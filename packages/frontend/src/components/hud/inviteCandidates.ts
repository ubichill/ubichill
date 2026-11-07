import type { InviteCandidate } from '@ubichill/shared';

/** 招待の画面の並び: 送れる人を先に、その中はどこかにいる人を先に、名前順。 */
export function orderCandidates(candidates: readonly InviteCandidate[]): InviteCandidate[] {
    return [...candidates].sort(
        (a, b) =>
            Number(a.refusal !== null) - Number(b.refusal !== null) ||
            Number(b.online) - Number(a.online) ||
            a.user.name.localeCompare(b.user.name, 'ja'),
    );
}

/** 選ぶ・外す。一度に送れる人数（API の上限）を超えて選ばせない（超えるとリクエスト全体が 400 になる）。 */
export function toggleInvitee(selected: ReadonlySet<string>, userId: string, max: number): ReadonlySet<string> {
    const next = new Set(selected);
    if (next.delete(userId)) return next;
    return next.size < max ? next.add(userId) : selected;
}
