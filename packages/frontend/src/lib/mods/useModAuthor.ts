import { useEffect, useState } from 'react';
import { MOD_BASE_URL } from '@/mods/modLoader';
import { fetchModAuthor } from '@/mods/modSignature';
import type { AvailableMod } from './useAvailableMods';

/** 確認中は 'checking'、確認できた作者アカウント、確認できなければ null（署名なし・作者を確認できない）。 */
export type ModAuthorState = 'checking' | string | null;

const cache = new Map<string, Promise<string | null>>();

function authorOf(mod: AvailableMod): Promise<string | null> {
    const baseUrl = mod.baseUrl ?? MOD_BASE_URL;
    const key = `${baseUrl}::${mod.id}@${mod.version}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const p = fetchModAuthor(baseUrl, mod.id, mod.version)
        .then((author) => author ?? null)
        .catch(() => null);
    cache.set(key, p);
    return p;
}

/** 一覧の mod（最新版）の作者を、配布物の署名から確認する。名乗っているだけの作者は表示しない。 */
export function useModAuthor(mod: AvailableMod): ModAuthorState {
    const [state, setState] = useState<ModAuthorState>('checking');
    useEffect(() => {
        let cancelled = false;
        setState('checking');
        authorOf(mod).then((author) => {
            if (!cancelled) setState(author);
        });
        return () => {
            cancelled = true;
        };
    }, [mod]);
    return state;
}
