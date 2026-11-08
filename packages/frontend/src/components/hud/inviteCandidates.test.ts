import type { InviteCandidate } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { orderCandidates, toggleInvitee } from './inviteCandidates';

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

describe('toggleInvitee', () => {
    it('上限まで選べ、上限では足さずに同じ集合を返す', () => {
        const full = ['a', 'b', 'c'].reduce<ReadonlySet<string>>((set, id) => toggleInvitee(set, id, 3), new Set());
        expect([...full]).toEqual(['a', 'b', 'c']);
        expect(toggleInvitee(full, 'd', 3)).toBe(full);
    });

    it('上限でも外せて、外せばまた選べる', () => {
        const full = new Set(['a', 'b']);
        const fewer = toggleInvitee(full, 'a', 2);
        expect([...fewer]).toEqual(['b']);
        expect([...toggleInvitee(fewer, 'c', 2)]).toEqual(['b', 'c']);
    });

    it('元の集合は変えない', () => {
        const before = new Set(['a']);
        toggleInvitee(before, 'b', 5);
        toggleInvitee(before, 'a', 5);
        expect([...before]).toEqual(['a']);
    });
});
