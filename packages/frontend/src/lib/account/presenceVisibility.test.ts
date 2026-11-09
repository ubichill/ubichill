import { PRESENCE_VISIBILITIES } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { PRESENCE_VISIBILITY_OPTIONS } from './presenceVisibility';

describe('PRESENCE_VISIBILITY_OPTIONS', () => {
    it('shared の見せ方をすべて、広い順に重複なく選べる（値が増えても選択肢の追加漏れに気づける）', () => {
        expect(PRESENCE_VISIBILITY_OPTIONS.map((o) => o.value)).toEqual([...PRESENCE_VISIBILITIES]);
    });

    it('見せないを選んでも、同じ部屋の人には見えることを伝える（隠れられると思わせない）', () => {
        expect(PRESENCE_VISIBILITY_OPTIONS.find((o) => o.value === 'hidden')?.description).toContain('同じ部屋');
    });
});
