import { CORE_COMPONENT_TYPES, ColliderDataSchema } from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { CORE_ENTITY_KINDS, entityKindsFromManifest, usableDataFields } from '../lib/entityKinds';

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

    it('thumbnail は版のディレクトリで絶対化し、hash を固定したものだけ出す', () => {
        const [kind] = entityKindsFromManifest('pen', { 'pen:pen': { thumbnail: 'icon.svg' } }, base, {
            'icon.svg': 'sha256-icon',
        });
        expect(kind?.thumbnail).toEqual({
            url: '/mods/pen/v2.0.0/icon.svg',
            integrity: 'sha256-icon',
            type: 'image/svg+xml',
        });
        // hash を固定していない画像は出さない（配布先で差し替えられても気付けないため）
        const [unpinned] = entityKindsFromManifest('pen', { 'pen:pen': { thumbnail: 'icon.svg' } }, base);
        expect(unpinned?.thumbnail).toBeUndefined();
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
