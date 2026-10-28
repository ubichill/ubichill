import { CORE_COMPONENT_TYPES, ColliderDataSchema } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { CORE_ENTITY_KINDS, entityKindsFromManifest } from './useAvailableEntityKinds';

describe('CORE_ENTITY_KINDS', () => {
    it('mod依存なしでも追加できる有効なColliderを公開する', () => {
        const collider = CORE_ENTITY_KINDS.find((kind) => kind.kind === CORE_COMPONENT_TYPES.collider);
        expect(collider).toMatchObject({ modName: 'core', viewKind: 'logic', suggestSize: true });
        expect(ColliderDataSchema.safeParse(collider?.defaultData).success).toBe(true);
    });
});

describe('entityKindsFromManifest', () => {
    const base = '/mods/pen/v2.0.0';

    it('データ専用 Component（mod が spawn するだけ）は配置できる種類に並べない', () => {
        const kinds = entityKindsFromManifest(
            'pen',
            {
                'pen:pen': { capabilities: ['ui:render'] },
                'pen:stroke': { dataOnly: true },
            },
            base,
        );
        expect(kinds.map((k) => k.kind)).toEqual(['pen:pen']);
    });

    it('dataOnly が false・省略のものは並べる（true 以外で消さない）', () => {
        const kinds = entityKindsFromManifest(
            'pen',
            { 'pen:a': { dataOnly: false }, 'pen:b': {}, 'pen:c': { canvasTargets: ['drawing'] } },
            base,
        );
        expect(kinds.map((k) => [k.kind, k.viewKind])).toEqual([
            ['pen:a', 'logic'],
            ['pen:b', 'logic'],
            ['pen:c', 'canvas'],
        ]);
    });

    it('thumbnail は版のディレクトリで絶対化する', () => {
        const [kind] = entityKindsFromManifest('pen', { 'pen:pen': { thumbnail: 'icon.svg' } }, base);
        expect(kind?.thumbnailUrl).toBe('/mods/pen/v2.0.0/icon.svg');
    });
});
