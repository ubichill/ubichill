import { HandleSchema } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { API_BASE } from '@/lib/api';

export type HandleAvailability =
    | { state: 'empty' }
    | { state: 'invalid'; error: string }
    | { state: 'checking' }
    | { state: 'available' }
    | { state: 'taken'; error: string };

/**
 * ID（handle）の形式をその場で確認し、形式が正しければサーバーに空きを問い合わせる（500ms デバウンス）。
 * 形式エラーは通信せずに返す（予約語・大文字・長さ）。
 */
export function useHandleAvailability(handle: string, enabled: boolean): HandleAvailability {
    const [remote, setRemote] = useState<HandleAvailability>({ state: 'empty' });
    const trimmed = handle.trim();
    const parsed = HandleSchema.safeParse(trimmed);
    const localError = trimmed && !parsed.success ? (parsed.error.issues[0]?.message ?? 'ID が不正です') : null;

    useEffect(() => {
        if (!enabled || !trimmed || localError) return;
        const ignore = { current: false };
        setRemote({ state: 'checking' });
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`${API_BASE}/api/v1/users/check-handle?handle=${encodeURIComponent(trimmed)}`);
                const data = (await res.json()) as { available?: boolean; error?: string | null };
                if (ignore.current) return;
                setRemote(
                    data.available
                        ? { state: 'available' }
                        : { state: 'taken', error: data.error ?? 'この ID は使用できません' },
                );
            } catch {
                if (!ignore.current) setRemote({ state: 'taken', error: '確認に失敗しました' });
            }
        }, 500);
        return () => {
            ignore.current = true;
            clearTimeout(timer);
        };
    }, [trimmed, enabled, localError]);

    if (!enabled || !trimmed) return { state: 'empty' };
    if (localError) return { state: 'invalid', error: localError };
    return remote;
}
