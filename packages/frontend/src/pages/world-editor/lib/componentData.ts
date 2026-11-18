/** `{ }` のオブジェクトか（null・配列・数値などを除く）。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ComponentDataParse = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** JSON タブの入力を Component の data にする。オブジェクト以外は data にしない（参照の付け替えや保存で落ちる）。 */
export function parseComponentDataJson(text: string): ComponentDataParse {
    try {
        const parsed: unknown = JSON.parse(text.trim() || '{}');
        return isPlainObject(parsed)
            ? { ok: true, data: parsed }
            : { ok: false, error: 'data は { } で囲んだオブジェクトにしてください' };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'JSON parse error' };
    }
}
