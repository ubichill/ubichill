import { MOD_AUTHOR_CACHE_TTL_MS } from '@ubichill/loader';
import { useCallback, useEffect, useState } from 'react';
import { MOD_BASE_URL } from '@/mods/modLoader';
import { fetchModAuthor, type ModAuthorCheck } from '@/mods/modSignature';
import type { AvailableMod } from './useAvailableMods';

export type ModAuthorState = { status: 'checking' } | ModAuthorCheck;
const cache = new Map<string, { checkedAt: number; result: ModAuthorCheck }>();

/** 選択した版の作者を確認する。失敗は記憶せず、再確認は成功キャッシュも取り直す。 */
export function useModAuthor(mod: AvailableMod, version: string): { state: ModAuthorState; retry: () => void } {
    const baseUrl = mod.baseUrl ?? MOD_BASE_URL;
    const key = `${baseUrl}::${mod.id}@${version}`;
    const [attempt, setAttempt] = useState(0);
    const [checked, setChecked] = useState<{ key: string; state: ModAuthorState }>({
        key,
        state: { status: 'checking' },
    });

    // biome-ignore lint/correctness/useExhaustiveDependencies: attempt は再確認の合図
    useEffect(() => {
        const cached = cache.get(key);
        if (cached && Date.now() - cached.checkedAt < MOD_AUTHOR_CACHE_TTL_MS) {
            setChecked({ key, state: cached.result });
            return;
        }
        let cancelled = false;
        setChecked({ key, state: { status: 'checking' } });
        fetchModAuthor(baseUrl, mod.id, version).then((result) => {
            if (cancelled) return;
            if (result.status === 'verified' || result.status === 'data-only')
                cache.set(key, { checkedAt: Date.now(), result });
            setChecked({ key, state: result });
        });
        return () => {
            cancelled = true;
        };
    }, [key, baseUrl, mod.id, version, attempt]);

    const retry = useCallback(() => {
        cache.delete(key);
        setAttempt((n) => n + 1);
    }, [key]);
    // 版を切り替えた直後にも、前の版の作者を表示しない。
    return { state: checked.key === key ? checked.state : { status: 'checking' }, retry };
}
