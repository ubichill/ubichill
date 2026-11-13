import { describe, expect, it } from 'vitest';
import { WorldDefinitionSchema } from '../schemas/world.schema';
import { checkWorldCompatibility, worldRequirementsFor } from './requirements';
import { mapToResolved } from './resolve';

describe('worldRequirementsFor', () => {
    it('要件の無いワールドには今の Host の版を書く', () => {
        expect(worldRequirementsFor(undefined, 7)).toEqual({ protocol: 7 });
    });

    it('古い版で保存したワールドは今の版に上げる', () => {
        expect(worldRequirementsFor({ protocol: 3 }, 7)).toEqual({ protocol: 7 });
    });

    it('新しい Host で保存した印を、古い Host で保存し直しても下げない', () => {
        expect(worldRequirementsFor({ protocol: 9 }, 7)).toEqual({ protocol: 9 });
    });
});

describe('checkWorldCompatibility', () => {
    it('同じ版と古い版は開ける', () => {
        expect(checkWorldCompatibility({ protocol: 7 }, 7, 0)).toEqual({ level: 'ok' });
        expect(checkWorldCompatibility({ protocol: 1 }, 7, 0)).toEqual({ level: 'ok' });
    });

    it('要件の無いワールドは、互換を切っていなければ開ける', () => {
        expect(checkWorldCompatibility(undefined, 7, 0)).toEqual({ level: 'ok' });
    });

    it('Host より新しいワールドは、一部が動かない可能性を知らせる', () => {
        const result = checkWorldCompatibility({ protocol: 8 }, 7, 0);
        expect(result).toMatchObject({ level: 'newer', required: 8, host: 7 });
        expect(result.level !== 'ok' && result.message).toContain('v8');
    });

    it('互換を切った版より前のワールドは、要件が無くても古いと分かる', () => {
        expect(checkWorldCompatibility(undefined, 12, 10)).toMatchObject({ level: 'outdated', required: 0 });
        expect(checkWorldCompatibility({ protocol: 9 }, 12, 10)).toMatchObject({ level: 'outdated', required: 9 });
        expect(checkWorldCompatibility({ protocol: 10 }, 12, 10)).toEqual({ level: 'ok' });
    });
});

describe('requires の読み書き', () => {
    const base = {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'room', version: '1.0.0' },
        spec: { displayName: 'Room', initialEntities: [] },
    };

    it('要件の無い既存のワールドもそのまま読める', () => {
        expect(WorldDefinitionSchema.parse(base).spec.requires).toBeUndefined();
    });

    it('整数でない版・負の版は受け付けない', () => {
        for (const protocol of [1.5, -1, '7'])
            expect(
                WorldDefinitionSchema.safeParse({ ...base, spec: { ...base.spec, requires: { protocol } } }).success,
            ).toBe(false);
    });

    it('解決したワールドに要件を引き継ぎ、無ければ項目を作らない', () => {
        const source = { kind: 'url', url: 'https://example.com/room.yaml' } as const;
        const withRequires = WorldDefinitionSchema.parse({
            ...base,
            spec: { ...base.spec, requires: { protocol: 7 } },
        });
        expect(mapToResolved(withRequires, source.url, source).requires).toEqual({ protocol: 7 });
        expect('requires' in mapToResolved(WorldDefinitionSchema.parse(base), source.url, source)).toBe(false);
    });
});
