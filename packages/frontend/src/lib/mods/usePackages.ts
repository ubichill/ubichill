import type { WorldDefinition } from '@ubichill/shared';
import { lockedMods } from '@ubichill/shared';
import { useEffect, useEffectEvent, useState } from 'react';
import { buildWorldLock } from '@/world/buildWorldLock';
import { MOD_CDN_URL } from './modCdn';
import { type EditorPackage, editorPackage } from './packages';

export function usePackages(definition: WorldDefinition | null) {
    const [packages, setPackages] = useState<EditorPackage[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const key = JSON.stringify([definition?.spec.dependencies, definition?.spec.lock]);
    const load = useEffectEvent(async () => {
        if (!definition) return [];
        const { lock, unpinned } = await buildWorldLock(definition, MOD_CDN_URL);
        if (unpinned.length) throw new Error(`取得できない mod: ${unpinned.join('、')}`);
        return Promise.all(Object.values(lockedMods(lock)).map(editorPackage));
    });
    // biome-ignore lint/correctness/useExhaustiveDependencies: key は package の取得先・固定内容が変わった場合だけ再取得するトリガー
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError('');
        load()
            .then((items) => {
                if (!cancelled) setPackages(items);
            })
            .catch((e: unknown) => {
                if (!cancelled) {
                    setPackages([]);
                    setError(e instanceof Error ? e.message : 'mod を取得できません');
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [key]);
    return { packages, loading, error };
}
