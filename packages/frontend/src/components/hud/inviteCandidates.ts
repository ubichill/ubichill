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
