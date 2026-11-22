import {
    CORE_COMPONENT_TYPES,
    ColliderDataSchema,
    isCoreComponentType,
    validateCoreComponentData,
} from '@ubichill/core-components';
import { describe, expect, it } from 'vitest';
import { displayedFieldValue } from '../components/inspector/fieldValues';
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

    it('置いた UI は、見える四角（白・枠線・角丸）にテキストが入り、ボタンではない。設定の選択肢には名前が付く', () => {
        const kind = CORE_ENTITY_KINDS.find((k) => k.kind === CORE_COMPONENT_TYPES.ui);
        const placed = withComponentAdded(
            {
                id: 'sign',
                transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
                tags: [],
                components: [],
                children: [],
            },
            CORE_COMPONENT_TYPES.ui,
            kind,
        );
        const data = placed.components[0]?.data;
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.ui, data).success).toBe(true);
        expect(data).toMatchObject({
            text: 'テキスト',
            size: 20,
            fill: '#ffffff',
            border: '#1b2a44',
            radius: 12,
            button: false,
        });
        // HTML は書いたときだけ（空の項目を足さない）
        expect(data).not.toHaveProperty('markup');
        expect(placed.transform).toMatchObject({ w: 200, h: 80 });
        const align = kind?.dataFields?.align;
        if (align?.type !== 'enum') throw new Error('揃えの欄が無い');
        for (const option of align.options) expect(align.optionLabels?.[option], option).toBeTruthy();
    });

    it('data に無い項目の欄には、部屋で描くときの値（schema の既定値）を出す（YAML で書いた UI の欄が描いたものと食い違わない）', () => {
        const checked = CORE_ENTITY_KINDS.flatMap((kind) => {
            const parsed = isCoreComponentType(kind.kind) ? validateCoreComponentData(kind.kind, {}) : null;
            if (!parsed?.success) return [];
            const drawn: Record<string, unknown> = parsed.data;
            return (
                Object.entries(kind.dataFields ?? {})
                    // 参照は data に無ければ空で出す（配線していないことを見せる）。schema の空の値と意味は同じ
                    .filter(([, spec]) => spec.type !== 'entityRef' && spec.type !== 'entityRefArray')
                    .map(([key, spec]) => ({
                        field: `${kind.kind}.${key}`,
                        shown: displayedFieldValue(spec, {}, key),
                        drawn: drawn[key],
                    }))
            );
        });
        expect(checked.filter(({ shown, drawn }) => JSON.stringify(shown) !== JSON.stringify(drawn))).toEqual([]);
        expect(checked.map(({ field }) => field)).toContain('core:ui.fill');
    });

    it('置いたテキストには、見える文字が入る（描く値の既定は空のまま）', () => {
        const kind = CORE_ENTITY_KINDS.find((k) => k.kind === CORE_COMPONENT_TYPES.text);
        const placed = withComponentAdded(
            {
                id: 'sign',
                transform: { x: 0, y: 0, z: 0, scale: 1, rotation: 0 },
                tags: [],
                components: [],
                children: [],
            },
            CORE_COMPONENT_TYPES.text,
            kind,
        );
        expect(placed.components[0]?.data).toMatchObject({ text: 'ようこそ' });
    });

    it('スクリプト（ワープ・スイッチ・ポータル）は、置いても見た目の項目を持たず、そのまま検証を通る', () => {
        for (const type of [CORE_COMPONENT_TYPES.warp, CORE_COMPONENT_TYPES.switch, CORE_COMPONENT_TYPES.portal]) {
            const kind = CORE_ENTITY_KINDS.find((k) => k.kind === type);
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
            expect(Object.keys(kind?.dataFields ?? {}), type).not.toContain('look');
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

    it('データ専用でも設定欄を持つ Component（ワールドの作者が置いて設定する部品）は並べる', () => {
        const kinds = entityKindsFromManifest(
            'danmaku',
            {
                'danmaku:enemy': { dataOnly: true, dataFields: { hp: { type: 'number', default: 20 } } },
                'danmaku:empty': { dataOnly: true, dataFields: {} },
                'danmaku:broken': { dataOnly: true, dataFields: { hp: null, label: 'x' } },
                'danmaku:array': { dataOnly: true, dataFields: ['hp'] },
            },
            base,
        );
        expect(kinds.map((k) => [k.kind, k.viewKind])).toEqual([['danmaku:enemy', 'logic']]);
        expect(kinds[0]?.dataFields).toEqual({ hp: { type: 'number', default: 20 } });
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
