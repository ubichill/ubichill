import { css } from '@/styled-system/css';
import type { DataFieldSpec } from '../../hooks/useAvailableEntityKinds';

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

export function detectType(v: unknown): 'string' | 'number' | 'boolean' | 'json' {
    if (typeof v === 'string') return 'string';
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
    }
}
