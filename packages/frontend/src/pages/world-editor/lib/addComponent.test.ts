import type { InitialEntity } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { withComponentAdded } from './addComponent';
import type { AvailableEntityKind } from './entityKinds';

const entity = (components: InitialEntity['components'] = []): InitialEntity => ({
    id: 'tv',
    transform: { x: 300, y: 200, z: 1, w: 200, h: 150, scale: 1, rotation: 0 },
    tags: [],
    components,
    children: [],
});

const kind = (patch: Partial<AvailableEntityKind>): AvailableEntityKind => ({
    modName: 'core',
    kind: 'core:media',
    suggestSize: true,
    viewKind: 'canvas',
    ...patch,
});

describe('withComponentAdded', () => {
    it('Component には transform を付けず、Entity の transform を継ぐ', () => {
        const next = withComponentAdded(entity(), 'core:media', kind({ defaultTransform: { w: 640, h: 360 } }));
        expect(next.components[0]).not.toHaveProperty('transform');
    });

    it('空の Entity には mod の大きさを使い、置いた場所は動かさない', () => {
        const next = withComponentAdded(
            entity(),
            'core:media',
            kind({ defaultTransform: { x: 0, y: 0, w: 640, h: 360 } }),
        );
        expect(next.transform).toMatchObject({ x: 300, y: 200, w: 640, h: 360 });
    });

    it('すでに Component のある Entity の大きさは変えない', () => {
        const next = withComponentAdded(
            entity([{ id: 'ui', type: 'core:ui', data: {} }]),
            'core:media',
            kind({ defaultTransform: { w: 640, h: 360 } }),
        );
        expect(next.transform).toMatchObject({ w: 200, h: 150 });
    });

    it('同じ型をもう一つ足しても id が重ならない', () => {
        const once = withComponentAdded(entity(), 'video-player:controls', undefined);
        const twice = withComponentAdded(once, 'video-player:controls', undefined);
        expect(twice.components.map((c) => c.id)).toEqual(['controls', 'controls-2']);
    });

    it('フィールドの default は既定 data を上書きし、既定 data は複製して共有しない', () => {
        const defaultData = { nested: { a: 1 }, title: 'x' };
        const next = withComponentAdded(
            entity(),
            'm:c',
            kind({ kind: 'm:c', defaultData, dataFields: { title: { type: 'string', default: 'y' } } }),
        );
        expect(next.components[0].data).toEqual({ nested: { a: 1 }, title: 'y' });
        expect(next.components[0].data.nested).not.toBe(defaultData.nested);
    });
});
