import { useCallback, useEffect, useState } from 'react';
import { MOD_BASE_URL } from '@/mods/modLoader';
import { fetchModAuthor, type ModAuthorCheck } from '@/mods/modSignature';
import type { AvailableMod } from './useAvailableMods';

export type ModAuthorState = { status: 'checking' } | ModAuthorCheck;

// 確定した結果だけを使い回す。「いまは確認できない」は残さず、開き直し・再試行で確認し直す。
const cache = new Map<string, ModAuthorCheck>();

/**
 * 一覧の mod の、指定した版の作者を配布物の署名から確認する。名乗っているだけの作者は表示しない。
 * `retry` は「いまは確認できない」ときの確認し直し。
 */
export function useModAuthor(mod: AvailableMod, version: string): { state: ModAuthorState; retry: () => void } {
    const baseUrl = mod.baseUrl ?? MOD_BASE_URL;
    const key = `${baseUrl}::${mod.id}@${version}`;
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState<ModAuthorState>(() => cache.get(key) ?? { status: 'checking' });

    // biome-ignore lint/correctness/useExhaustiveDependencies: attempt は確認し直しの合図
    useEffect(() => {
        const cached = cache.get(key);
        if (cached) {
            setState(cached);
            return;
        }
        let cancelled = false;
        setState({ status: 'checking' });
        fetchModAuthor(baseUrl, mod.id, version).then((result) => {
            if (result.status !== 'unavailable') cache.set(key, result);
            if (!cancelled) setState(result);
        });
        return () => {
            cancelled = true;
        };
    }, [key, baseUrl, mod.id, version, attempt]);

    const retry = useCallback(() => setAttempt((n) => n + 1), []);
    return { state, retry };
}
