import { describe, expect, it } from 'vitest';
import { WorldDefinitionSchema } from '../schemas/world.schema';
import { checkWorldCompatibility, selectableProtocolVersions, worldRequirementsFor } from './requirements';
import { mapToResolved } from './resolve';

describe('worldRequirementsFor', () => {
    it('要件の無いワールドは今の Host の版で固定する', () => {
        expect(worldRequirementsFor(undefined, 7)).toEqual({ protocol: 7 });
    });

    it('固定した版は、Host が新しくなっても上げない（mod の版と同じく作者が選ぶ）', () => {
        expect(worldRequirementsFor({ protocol: 3 }, 7)).toEqual({ protocol: 3 });
    });

    it('新しい Host で固定した版も、古い Host で保存し直して下げない', () => {
        expect(worldRequirementsFor({ protocol: 9 }, 7)).toEqual({ protocol: 9 });
    });
});

describe('selectableProtocolVersions', () => {
    it('今の版から Host の版までを新しい順に出す（下げる選択肢は出さない）', () => {
        expect(selectableProtocolVersions(5, 7)).toEqual([7, 6, 5]);
    });

    it('Host と同じ版なら、その版だけ', () => {
        expect(selectableProtocolVersions(7, 7)).toEqual([7]);
    });

    it('Host より新しい版に固定したワールドは、その版だけ（この Host の版へ下げない）', () => {
        expect(selectableProtocolVersions(9, 7)).toEqual([9]);
    });
});

describe('checkWorldCompatibility', () => {
    it('同じ版・古い版に固定したワールドは知らせずに開く（古い版として動かす）', () => {
        expect(checkWorldCompatibility({ protocol: 7 }, 7)).toEqual({ level: 'ok' });
        expect(checkWorldCompatibility({ protocol: 1 }, 7)).toEqual({ level: 'ok' });
        expect(checkWorldCompatibility(undefined, 7)).toEqual({ level: 'ok' });
    });

    it('Host より新しいワールドは、一部が動かない可能性を知らせる', () => {
        const result = checkWorldCompatibility({ protocol: 8 }, 7);
        expect(result).toMatchObject({ level: 'newer', required: 8, host: 7 });
        expect(result.level !== 'ok' && result.message).toContain('v8');
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
