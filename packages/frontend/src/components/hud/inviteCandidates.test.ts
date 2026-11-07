import type { InviteCandidate } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { orderCandidates } from './inviteCandidates';

const c = (name: string, refusal: InviteCandidate['refusal'], online: boolean): InviteCandidate => ({
    user: { id: name, name, handle: name, image: null, bio: null },
    refusal,
    online,
});

describe('orderCandidates', () => {
    it('送れる人 → どこかにいる人 → 名前順。送れない人はいても最後', () => {
        const ordered = orderCandidates([
            c('あお', 'needs-leader', true),
            c('かい', null, false),
            c('いと', null, true),
            c('うみ', null, true),
            c('えま', 'already-inside', true),
        ]);
        expect(ordered.map((x) => x.user.name)).toEqual(['いと', 'うみ', 'かい', 'あお', 'えま']);
    });

    it('元の配列は並べ替えない', () => {
        const input = [c('b', null, false), c('a', null, false)];
        orderCandidates(input);
        expect(input.map((x) => x.user.name)).toEqual(['b', 'a']);
    });
});
