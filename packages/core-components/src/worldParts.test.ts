import { describe, expect, it } from 'vitest';
import {
    CORE_COMPONENT_TYPES,
    isCoreComponentType,
    readCoreComponentData,
    SpawnDataSchema,
    SwitchDataSchema,
    validateCoreComponentData,
    WarpDataSchema,
} from './index.js';

describe('core:spawn・core:warp・core:switch', () => {
    it('本体の部品として知っている', () => {
        for (const type of ['core:spawn', 'core:warp', 'core:switch']) expect(isCoreComponentType(type)).toBe(true);
    });

    it('最初の場所は設定を持たない', () => {
        expect(SpawnDataSchema.safeParse({}).success).toBe(true);
        expect(validateCoreComponentData('core:spawn', { x: 1 }).success).toBe(false);
    });

    it('ワープは行き先が空でもよい（置いた直後）。行き先は Entity の ID の形だけ', () => {
        expect(WarpDataSchema.parse({})).toEqual({ target: '', label: '', look: 'standard' });
        expect(WarpDataSchema.safeParse({ target: 'plaza-2' }).success).toBe(true);
        for (const target of ['Plaza', '../x', 'javascript:alert(1)', 'a'.repeat(51)])
            expect(WarpDataSchema.safeParse({ target }).success).toBe(false);
        expect(WarpDataSchema.safeParse({ label: 'x'.repeat(61) }).success).toBe(false);
    });

    it('スイッチの対象は空の ID を持てず、32 個まで', () => {
        expect(SwitchDataSchema.parse({})).toEqual({ targets: [], label: '', look: 'standard' });
        expect(SwitchDataSchema.safeParse({ targets: ['door', 'lamp'] }).success).toBe(true);
        expect(SwitchDataSchema.safeParse({ targets: [''] }).success).toBe(false);
        expect(SwitchDataSchema.safeParse({ targets: Array.from({ length: 33 }, (_, i) => `e${i}`) }).success).toBe(
            false,
        );
        expect(SwitchDataSchema.safeParse({ targets: 'door' }).success).toBe(false);
    });
});

describe('押せる部品の見た目（look）', () => {
    const parts = [CORE_COMPONENT_TYPES.warp, CORE_COMPONENT_TYPES.switch, CORE_COMPONENT_TYPES.portal] as const;

    it('書いていない古いワールドは標準の見た目のまま', () => {
        for (const type of parts) {
            const result = validateCoreComponentData(type, {});
            expect(result.success && result.data.look, type).toBe('standard');
        }
    });

    it('standard と none を受け付ける', () => {
        for (const type of parts) {
            for (const look of ['standard', 'none']) {
                const result = validateCoreComponentData(type, { look });
                expect(result.success && result.data.look, `${type} ${look}`).toBe(look);
            }
        }
    });

    it('ほかの値は断る（大文字・空・真偽値・null も）', () => {
        for (const type of parts) {
            for (const look of ['None', 'hidden', '', ' none', true, null, 0, ['none']]) {
                expect(validateCoreComponentData(type, { look }).success, `${type} ${String(look)}`).toBe(false);
            }
        }
    });

    it('読む側も値の誤りは断る（知らない項目と違い、捨てて読まない）', () => {
        expect(readCoreComponentData(CORE_COMPONENT_TYPES.warp, { target: 'plaza', look: 'glow' }).success).toBe(false);
    });

    it('見た目を変えても、ほかの設定はそのまま', () => {
        expect(
            validateCoreComponentData(CORE_COMPONENT_TYPES.portal, { world: '@alice/cafe', look: 'none' }).data,
        ).toEqual({ world: '@alice/cafe', label: '', look: 'none' });
        expect(
            validateCoreComponentData(CORE_COMPONENT_TYPES.switch, { targets: ['door'], label: '扉', look: 'none' })
                .data,
        ).toEqual({ targets: ['door'], label: '扉', look: 'none' });
    });

    it('画像・最初の場所には無い項目', () => {
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.image, { look: 'none' }).success).toBe(false);
        expect(validateCoreComponentData(CORE_COMPONENT_TYPES.spawn, { look: 'none' }).success).toBe(false);
    });
});
