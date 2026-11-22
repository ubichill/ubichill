import {
    CORE_COMPONENT_TYPES,
    ColliderDataSchema,
    PART_LOOKS,
    PartLookSchema,
    validateCoreComponentData,
} from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { withComponentAdded } from '../lib/addComponent';
import { CORE_ENTITY_KINDS, entityKindsFromManifest, usableDataFields } from '../lib/entityKinds';

describe('CORE_ENTITY_KINDS', () => {
    it('mod依存なしでも追加できる有効なColliderを公開する', () => {
        const collider = CORE_ENTITY_KINDS.find((kind) => kind.kind === CORE_COMPONENT_TYPES.collider);
        expect(collider).toMatchObject({ modName: 'core', viewKind: 'logic', suggestSize: true });
        expect(ColliderDataSchema.safeParse(collider?.defaultData).success).toBe(true);
    });

    it('本体の部品はすべて、型の名前の読みを表示名に持つ（YAML の core:portal とエディタの「ポータル」を対応させる）', () => {
        const names = Object.fromEntries(CORE_ENTITY_KINDS.map((kind) => [kind.kind, kind.displayName]));
        expect(names).toEqual({
            [CORE_COMPONENT_TYPES.collider]: 'コライダー',
            [CORE_COMPONENT_TYPES.media]: 'メディア',
            [CORE_COMPONENT_TYPES.ui]: 'UI',
            [CORE_COMPONENT_TYPES.image]: 'イメージ',
            [CORE_COMPONENT_TYPES.text]: 'テキスト',
            [CORE_COMPONENT_TYPES.portal]: 'ポータル',
            [CORE_COMPONENT_TYPES.warp]: 'ワープ',
            [CORE_COMPONENT_TYPES.switch]: 'スイッチ',
            [CORE_COMPONENT_TYPES.spawn]: 'スポーン',
        });
        // 本体の部品を足したら、ここに名前を足す（型の名前のまま英語で並ばないように）
        expect(Object.keys(names).sort()).toEqual(Object.values(CORE_COMPONENT_TYPES).sort());
    });

    it('押せる部品の「見た目」は schema と同じ選択肢に名前を付けて出し、置いたときは data に書かない', () => {
        for (const type of [CORE_COMPONENT_TYPES.warp, CORE_COMPONENT_TYPES.switch, CORE_COMPONENT_TYPES.portal]) {
            const kind = CORE_ENTITY_KINDS.find((k) => k.kind === type);
            const look = kind?.dataFields?.look;
            if (look?.type !== 'enum') throw new Error(`${type} に見た目の欄が無い`);
            // 欄は data に無いとき先頭の選択肢を出すので、先頭が schema の既定と同じでないといけない
            expect(look.options, type).toEqual([...PART_LOOKS]);
            expect(look.options[0]).toBe(PartLookSchema.parse(undefined));
            for (const option of look.options) expect(look.optionLabels?.[option], option).toBeTruthy();

            const placed = withComponentAdded(
                {
                    id: 'door',
                    transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
                    tags: [],
                    components: [],
                    children: [],
                },
                type,
                kind,
            ).components[0];
            expect(placed?.data, type).not.toHaveProperty('look');
            expect(validateCoreComponentData(type, placed?.data).success, type).toBe(true);
        }
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
