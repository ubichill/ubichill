import type { z } from 'zod';

/**
 * 読む側（部屋・サーバー）で本体の部品の data を読む。知らない項目（新しい ubichill で足した項目）は捨てて読み、
 * 値の誤りだけを断る。書く側（エディタ・CLI）は {@link unknownKeysOf} で知らない項目も問題にする。
 */
export function readCoreData<S extends z.ZodType>(schema: S, data: unknown): z.ZodSafeParseResult<z.output<S>> {
    const first = schema.safeParse(data);
    if (first.success) return first;
    const unknown = first.error.issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys' ? [{ path: issue.path, keys: issue.keys }] : [],
    );
    if (unknown.length === 0) return first;
    return schema.safeParse(unknown.reduce((value, { path, keys }) => omitAt(value, path, keys), data));
}

/** strict な schema が断る、知らない項目の場所（`offset.z` のように `.` でつなぐ）。 */
export function unknownKeysOf(schema: z.ZodType, data: unknown): string[] {
    const result = schema.safeParse(data);
    if (result.success) return [];
    return result.error.issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys' ? issue.keys.map((key) => [...issue.path, key].map(String).join('.')) : [],
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function omitAt(value: unknown, path: readonly PropertyKey[], keys: readonly string[]): unknown {
    const [head, ...rest] = path;
    if (head === undefined)
        return isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k))) : value;
    if (Array.isArray(value) && typeof head === 'number')
        return value.map((item, i) => (i === head ? omitAt(item, rest, keys) : item));
    if (isRecord(value) && typeof head === 'string') return { ...value, [head]: omitAt(value[head], rest, keys) };
    return value;
}
