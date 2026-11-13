import type { AvailableEntityKind } from './entityKinds';

/** 追加の一覧の 1 件。名前は表示名、無ければ型の `:` より後ろ。 */
export interface ComponentPickerItem {
    kind: AvailableEntityKind;
    label: string;
}

/**
 * Component 追加の一覧（純粋）。mod ごと（本体の標準部品を先頭）にまとめ、名前順に並べる。
 * 絞り込みは名前・型の部分一致（大文字小文字を区別しない）。
 */
export function componentPickerItems(kinds: readonly AvailableEntityKind[], query: string): ComponentPickerItem[] {
    const q = query.trim().toLowerCase();
    return kinds
        .map((kind) => ({ kind, label: kind.displayName ?? (kind.kind.split(':').slice(1).join(':') || kind.kind) }))
        .filter(({ kind, label }) => !q || label.toLowerCase().includes(q) || kind.kind.toLowerCase().includes(q))
        .sort(
            (a, b) =>
                Number(b.kind.modName === 'core') - Number(a.kind.modName === 'core') ||
                a.kind.modName.localeCompare(b.kind.modName) ||
                a.label.localeCompare(b.label, 'ja'),
        );
}
