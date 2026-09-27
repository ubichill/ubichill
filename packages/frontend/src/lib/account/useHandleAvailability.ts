import { DisplayNameSchema, HandleSchema } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';

/** 形式チェックに使うスキーマ（shared の zod スキーマが満たす最小の形）。 */
interface NameSchema {
    safeParse(value: string): { success: true } | { success: false; error: { issues: Array<{ message: string }> } };
}

export type NameAvailability =
    | { state: 'empty' }
    | { state: 'invalid'; error: string }
    | { state: 'checking' }
    | { state: 'available' }
    | { state: 'taken'; error: string };

/**
 * 形式をその場で確認し、形式が正しければサーバーに空きを問い合わせる（500ms デバウンス）。
 * 形式エラーは通信せずに返す。
 */
function useNameAvailability(
    value: string,
    enabled: boolean,
    schema: NameSchema,
    urlFor: (v: string) => string,
): NameAvailability {
    const [remote, setRemote] = useState<NameAvailability>({ state: 'empty' });
    const trimmed = value.trim();
    const parsed = schema.safeParse(trimmed);
    const localError = trimmed && !parsed.success ? (parsed.error.issues[0]?.message ?? '形式が不正です') : null;

    useEffect(() => {
        if (!enabled || !trimmed || localError) return;
        const ignore = { current: false };
        setRemote({ state: 'checking' });
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(urlFor(trimmed), { credentials: 'include' });
                const data = (await res.json()) as { available?: boolean; error?: string | null };
                if (ignore.current) return;
                setRemote(
                    data.available ? { state: 'available' } : { state: 'taken', error: data.error ?? '使用できません' },
                );
            } catch {
                if (!ignore.current) setRemote({ state: 'taken', error: '確認に失敗しました' });
            }
        }, 500);
        return () => {
            ignore.current = true;
            clearTimeout(timer);
        };
    }, [trimmed, enabled, localError, urlFor]);

    if (!enabled || !trimmed) return { state: 'empty' };
    if (localError) return { state: 'invalid', error: localError };
    return remote;
}

const handleUrl = (v: string) => `${API_BASE}/api/v1/users/check-handle?handle=${encodeURIComponent(v)}`;
const displayNameUrl = (v: string) => `${API_BASE}/api/v1/users/check-display-name?name=${encodeURIComponent(v)}`;

/** ID（handle）の空き確認。 */
export function useHandleAvailability(handle: string, enabled: boolean): NameAvailability {
    return useNameAvailability(handle, enabled, HandleSchema, handleUrl);
}

/** 表示名の空き確認（一意。全角半角・大文字小文字・空白の違いは同じ名前）。 */
export function useDisplayNameAvailability(name: string, enabled: boolean): NameAvailability {
    return useNameAvailability(name, enabled, DisplayNameSchema, displayNameUrl);
}
