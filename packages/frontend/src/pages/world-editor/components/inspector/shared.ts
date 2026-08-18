import { css } from '@/styled-system/css';
import type { DataFieldSpec, DataFields } from '../../hooks/useAvailableEntityKinds';

export const inputStyle = css({
    width: '100%',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontSize: '12px',
    outline: 'none',
    _focus: { borderColor: 'primary' },
});

export const textareaStyle = css({
    width: '100%',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontFamily: 'mono',
    fontSize: '11px',
    outline: 'none',
    resize: 'vertical',
    _focus: { borderColor: 'primary' },
});

export function detectType(v: unknown): 'string' | 'number' | 'boolean' | 'color' | 'json' {
    if (typeof v === 'string') return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? 'color' : 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'json';
}

export function defaultForType(spec: DataFieldSpec): unknown {
    switch (spec.type) {
        case 'string':
        case 'url':
            return '';
        case 'number':
            return 0;
        case 'boolean':
            return false;
        case 'color':
            return '#000000';
        case 'enum':
            return spec.options[0] ?? '';
        case 'json':
            return null;
        case 'array':
            return [];
        case 'entityRef':
            return null;
        case 'entityRefArray':
            return [];
    }
}

/**
 * Inspector のフィールド定義を manifest `dataFields` と state 由来 `runtimeSchema` から合成する。
 *
 * - `runtimeSchema`（worker が報告した Ubi.state）を優先する（編集可能値の正本は state）。
 * - ただし `entityRef`/`entityRefArray` は manifest `dataFields` 専用の構造宣言で、state 側では
 *   宣言しない（型推論で json 等になってしまう）。そのため manifest の entityRef 系だけは
 *   state の推論型で上書きしない。
 * - 合成結果が空なら undefined（呼び出し側で既知/未知コンポーネントを判定する）。
 */
export function mergeDataFields(
    manifest: DataFields | undefined,
    runtime: DataFields | undefined,
): DataFields | undefined {
    const merged: DataFields = { ...(manifest ?? {}), ...(runtime ?? {}) };
    for (const [key, spec] of Object.entries(manifest ?? {})) {
        if (spec.type === 'entityRef' || spec.type === 'entityRefArray') merged[key] = spec;
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}
