import { describe, expect, it } from 'vitest';
import { componentPickerItems } from './componentPicker';
import type { AvailableEntityKind } from './entityKinds';

const kind = (type: string, extra: Partial<AvailableEntityKind> = {}): AvailableEntityKind => ({
    modName: type.split(':')[0] ?? type,
    kind: type,
    suggestSize: false,
    viewKind: 'jsx',
    ...extra,
});

describe('componentPickerItems', () => {
    const kinds = [kind('pen:tray'), kind('danmaku:wall'), kind('core:ui'), kind('pen:pen', { displayName: 'ペン' })];

    it('本体の標準部品を先頭に、mod ごと・名前順に並べる', () => {
        expect(componentPickerItems(kinds, '').map((i) => i.kind.kind)).toEqual([
            'core:ui',
            'danmaku:wall',
            'pen:tray',
            'pen:pen',
        ]);
    });

    it('名前は表示名、無ければ型の後ろ半分', () => {
        expect(componentPickerItems(kinds, '').map((i) => i.label)).toEqual(['ui', 'wall', 'tray', 'ペン']);
    });

    it('名前・型の部分一致で絞り込む', () => {
        expect(componentPickerItems(kinds, 'ペン').map((i) => i.kind.kind)).toEqual(['pen:pen']);
        expect(componentPickerItems(kinds, ' PEN: ').map((i) => i.kind.kind)).toEqual(['pen:tray', 'pen:pen']);
        expect(componentPickerItems(kinds, 'none')).toEqual([]);
    });
});
