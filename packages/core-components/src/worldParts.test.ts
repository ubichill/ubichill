import { describe, expect, it } from 'vitest';
import {
    CORE_COMPONENT_TYPES,
    isCoreComponentType,
    readCoreComponentData,
    SpawnDataSchema,
    SwitchDataSchema,
    UI_BORDER_WIDTH_MAX,
    UI_RADIUS_MAX,
    UiDataSchema,
    validateCoreComponentData,
    WarpDataSchema,
} from './index.js';

describe('core:spawn・core:warp・core:switch', () => {
    it('本体の部品として知っている', () => {
        for (const type of ['core:spawn', 'core:warp', 'core:switch']) expect(isCoreComponentType(type)).toBe(true);
    });

    it('スポーンは設定を持たない', () => {
        expect(SpawnDataSchema.safeParse({}).success).toBe(true);
        expect(validateCoreComponentData('core:spawn', { x: 1 }).success).toBe(false);
    });

    it('ワープは行き先が空でもよい（置いた直後）。行き先は Entity の ID の形だけ', () => {
        expect(WarpDataSchema.parse({})).toEqual({ target: '', label: '' });
        expect(WarpDataSchema.safeParse({ target: 'plaza-2' }).success).toBe(true);
        for (const target of ['Plaza', '../x', 'javascript:alert(1)', 'a'.repeat(51)])
            expect(WarpDataSchema.safeParse({ target }).success).toBe(false);
        expect(WarpDataSchema.safeParse({ label: 'x'.repeat(61) }).success).toBe(false);
    });

    it('スイッチの対象は空の ID を持てず、32 個まで', () => {
        expect(SwitchDataSchema.parse({})).toEqual({ targets: [], label: '' });
        expect(SwitchDataSchema.safeParse({ targets: ['door', 'lamp'] }).success).toBe(true);
        expect(SwitchDataSchema.safeParse({ targets: [''] }).success).toBe(false);
        expect(SwitchDataSchema.safeParse({ targets: Array.from({ length: 33 }, (_, i) => `e${i}`) }).success).toBe(
            false,
        );
        expect(SwitchDataSchema.safeParse({ targets: 'door' }).success).toBe(false);
    });
});

describe('core:ui（四角・テキスト・ボタン）', () => {
    it('書いていない項目は描かない（前の版の markup だけの UI の見た目を変えない）', () => {
        const old = UiDataSchema.parse({ markup: '<p>案内</p>' });
        expect(old).toMatchObject({
            markup: '<p>案内</p>',
            text: '',
            fill: 'transparent',
            border: 'transparent',
            radius: 0,
            button: false,
        });
    });

    it('四角・テキスト・ボタンを持てる', () => {
        const box = { text: 'ワープ', fill: '#ffffff', border: '#1b2a44', borderWidth: 2, radius: 12, button: true };
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.ui, box).success).toBe(true);
    });

    it('角丸・枠線・大きさは範囲の中だけ。色は #RRGGBB か transparent', () => {
        for (const bad of [
            { radius: -1 },
            { radius: UI_RADIUS_MAX + 1 },
            { borderWidth: UI_BORDER_WIDTH_MAX + 1 },
            { size: 7 },
            { fill: 'red' },
            { border: '#fff' },
            { align: 'justify' },
            { button: 'yes' },
        ])
            expect(validateCoreComponentData(CORE_COMPONENT_TYPES.ui, bad).success, JSON.stringify(bad)).toBe(false);
    });

    it('読む側は知らない項目を捨てて読む（新しい版の UI も開ける）', () => {
        const read = readCoreComponentData(CORE_COMPONENT_TYPES.ui, { text: 'a', shadow: true });
        expect(read.success && read.data.text).toBe('a');
    });
});
