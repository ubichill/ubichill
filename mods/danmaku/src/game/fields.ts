/**
 * Inspector の値・同期された値を読む。Entity の data はワールドの作者や他のクライアントが書くので信用しない。
 * 範囲外は範囲に収め、数でないもの・NaN・Infinity は既定値にする。
 */

export type FieldData = Readonly<Record<string, unknown>>;

export interface NumberRange {
    readonly fallback: number;
    readonly min: number;
    readonly max: number;
}

export function readNumber(data: FieldData, key: string, range: NumberRange): number {
    const raw = data[key];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : range.fallback;
    return Math.max(range.min, Math.min(value, range.max));
}

export function readInteger(data: FieldData, key: string, range: NumberRange): number {
    return Math.round(readNumber(data, key, range));
}

export function readEnum<const T extends string>(data: FieldData, key: string, options: readonly T[], fallback: T): T {
    const raw = data[key];
    return options.find((option) => option === raw) ?? fallback;
}

export function readBoolean(data: FieldData, key: string, fallback: boolean): boolean {
    const raw = data[key];
    return typeof raw === 'boolean' ? raw : fallback;
}

/** `#rgb` / `#rrggbb` だけを色として受け付ける（canvas の fillStyle に任意の文字列を渡さない）。 */
export function readColor(data: FieldData, key: string, fallback: string): string {
    const raw = data[key];
    return typeof raw === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw) ? raw : fallback;
}

export function asFieldData(value: unknown): FieldData {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as FieldData) : {};
}
