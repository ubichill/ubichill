import type { DataFieldSpec } from '../../hooks/useAvailableEntityKinds';

/**
 * Inspector に出す値。data に無いフィールドは宣言の既定値を出す。ただし参照フィールドは空で出す:
 * 配送・検査は data だけを読むので、既定値を出すと「配線済み」に見えて実際は誰にも届かない。
 * 参照の既定値は Component を足したときに data へ書く初期値としてだけ使う。
 */
export function displayedFieldValue(
    spec: DataFieldSpec,
    data: Readonly<Record<string, unknown>>,
    key: string,
): unknown {
    if (Object.hasOwn(data, key)) return data[key];
    if (spec.type === 'entityRef' || spec.type === 'entityRefArray') return defaultForType(spec);
    return spec.default ?? defaultForType(spec);
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
