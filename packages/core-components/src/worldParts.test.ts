import { describe, expect, it } from 'vitest';
import {
    isCoreComponentType,
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
