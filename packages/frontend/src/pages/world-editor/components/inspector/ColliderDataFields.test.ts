import { ColliderDataSchema, createDefaultColliderData } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { normalizeColliderForEditor } from './colliderEditorData';

describe('normalizeColliderForEditor', () => {
    it('空データをEntity寸法共有の有効な矩形Colliderにする', () => {
        const collider = normalizeColliderForEditor({});
        expect(collider).toEqual(createDefaultColliderData('rect'));
        expect(ColliderDataSchema.safeParse(collider).success).toBe(true);
    });

    it('円へ切り替えたデータに矩形専用sizeを残さない', () => {
        const collider = normalizeColliderForEditor({ shape: 'circle', size: 'entity', radius: 24 });
        expect(collider).toMatchObject({ shape: 'circle', radius: 24 });
        expect(collider).not.toHaveProperty('size');
        expect(ColliderDataSchema.safeParse(collider).success).toBe(true);
    });

    it('不完全な既存データをフォームから修復できる', () => {
        const collider = normalizeColliderForEditor({ shape: 'rect', offset: { x: 3 }, mask: 'wall' });
        expect(collider).toMatchObject({ shape: 'rect', size: 'entity', offset: { x: 3, y: 0 }, mask: ['default'] });
        expect(ColliderDataSchema.safeParse(collider).success).toBe(true);
    });
});
