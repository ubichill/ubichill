import { parsePortalTarget } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { portalPath } from './portalPath';

const path = (value: string) => {
    const target = parsePortalTarget(value);
    if (!target) throw new Error(value);
    return portalPath(target);
};

describe('portalPath', () => {
    it('行き先の書き方ごとに、ワールドのページへ', () => {
        expect(path('@alice/cafe')).toBe('/@alice/cafe');
        expect(path('@alice/作業部屋')).toBe(`/@alice/${encodeURIComponent('作業部屋')}`);
        expect(path('default')).toBe('/world/default');
        expect(path('https://example.com/w/cafe.yaml?x=1')).toBe(
            `/world?url=${encodeURIComponent('https://example.com/w/cafe.yaml?x=1')}`,
        );
    });
});
