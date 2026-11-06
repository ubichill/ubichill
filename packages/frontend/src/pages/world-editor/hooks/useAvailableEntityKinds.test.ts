import { CORE_COMPONENT_TYPES, ColliderDataSchema } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { CORE_ENTITY_KINDS, usableDataFields } from './useAvailableEntityKinds';

describe('CORE_ENTITY_KINDS', () => {
    it('mod依存なしでも追加できる有効なColliderを公開する', () => {
        const collider = CORE_ENTITY_KINDS.find((kind) => kind.kind === CORE_COMPONENT_TYPES.collider);
        expect(collider).toMatchObject({ modName: 'core', viewKind: 'logic', suggestSize: true });
        expect(ColliderDataSchema.safeParse(collider?.defaultData).success).toBe(true);
    });
});

describe('usableDataFields', () => {
    it('type を持つ宣言だけを残し、null・文字列・type の無い宣言を捨てる', () => {
        expect(
            usableDataFields({
                screen: { type: 'entityRef', component: 'core:media' },
                broken: null,
                text: 'string',
                noType: { label: 'x' },
                badType: { type: 3 },
            }),
        ).toEqual({ screen: { type: 'entityRef', component: 'core:media' } });
    });

    it('dataFields 自体が object でなければ宣言なし扱い', () => {
        expect(usableDataFields(null)).toBeUndefined();
        expect(usableDataFields(['entityRef'])).toBeUndefined();
        expect(usableDataFields('x')).toBeUndefined();
        expect(usableDataFields(undefined)).toBeUndefined();
    });
});
