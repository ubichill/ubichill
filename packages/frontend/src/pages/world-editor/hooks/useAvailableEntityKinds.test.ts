import { CORE_COMPONENT_TYPES, ColliderDataSchema } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { CORE_ENTITY_KINDS } from './useAvailableEntityKinds';

describe('CORE_ENTITY_KINDS', () => {
    it('mod依存なしでも追加できる有効なColliderを公開する', () => {
        const collider = CORE_ENTITY_KINDS.find((kind) => kind.kind === CORE_COMPONENT_TYPES.collider);
        expect(collider).toMatchObject({ modName: 'core', viewKind: 'logic', suggestSize: true });
        expect(ColliderDataSchema.safeParse(collider?.defaultData).success).toBe(true);
    });
});
