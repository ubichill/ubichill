import { describe, expect, it, vi } from 'vitest';
import { createPortalLookup, portalWorldRef } from './portalDestination';

describe('portalWorldRef', () => {
    it('行き先の種類ごとに、ワールドを引く参照にする', () => {
        expect(portalWorldRef({ kind: 'share', path: '@youkan/garden' })).toBe('@youkan/garden');
        expect(portalWorldRef({ kind: 'id', id: 'abc123' })).toBe('abc123');
        expect(portalWorldRef({ kind: 'url', url: 'https://example.com/w.yaml' })).toBe('https://example.com/w.yaml');
    });
});

describe('createPortalLookup', () => {
    it('名前とサムネイルを返し、同じ行き先は 1 回だけ引く', async () => {
        const fetchWorld = vi.fn(async () => ({ displayName: '庭', thumbnail: 'https://example.com/t.png' }));
        const lookup = createPortalLookup(fetchWorld);
        const target = { kind: 'share', path: '@youkan/garden' } as const;
        const [a, b] = await Promise.all([lookup(target), lookup(target)]);
        expect(a).toEqual({ name: '庭', thumbnail: 'https://example.com/t.png' });
        expect(b).toBe(a);
        expect(fetchWorld).toHaveBeenCalledTimes(1);
    });

    it('サムネイルの無い（必須にする前に公開された）ワールドは名前だけ', async () => {
        const lookup = createPortalLookup(async () => ({ displayName: '古いワールド' }));
        expect(await lookup({ kind: 'id', id: 'old' })).toEqual({ name: '古いワールド' });
    });

    it('引けなければ null を返し、何度も問い合わせない', async () => {
        const fetchWorld = vi.fn(async () => {
            throw new Error('World not found');
        });
        const lookup = createPortalLookup(fetchWorld);
        expect(await lookup({ kind: 'id', id: 'gone' })).toBeNull();
        expect(await lookup({ kind: 'id', id: 'gone' })).toBeNull();
        expect(fetchWorld).toHaveBeenCalledTimes(1);
    });
});
