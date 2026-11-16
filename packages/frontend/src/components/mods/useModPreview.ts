import type { ModLockEntry } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import { type ModPreview, type ModPreviewTarget, modPreview } from '@/lib/mods/modPreview';
import { editorPackageBytes } from '@/lib/mods/packages';

const cache = new Map<string, Promise<ModPreview>>();
const keyOf = (target: ModPreviewTarget) => `${target.baseUrl ?? ''} ${target.id} ${target.version}`;

/** 同じ mod の同じ版は 1 回だけ調べる（失敗は覚えない）。 */
function cachedPreview(target: ModPreviewTarget, locked?: ModLockEntry) {
    const key = keyOf(target);
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = modPreview(target, { fallbackBase: MOD_CDN_URL, fetchBytes: editorPackageBytes, locked });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
    return pending;
}

/** 一覧に出す mod の名前・説明・サムネイル。調べ終わるまで（と取れなかったとき）は undefined。 */
export function useModPreview(target: ModPreviewTarget | undefined, locked?: ModLockEntry): ModPreview | undefined {
    const [preview, setPreview] = useState<{ key: string; value: ModPreview } | null>(null);
    const key = target ? keyOf(target) : '';
    // biome-ignore lint/correctness/useExhaustiveDependencies: target・locked の同一性は key で決める
    useEffect(() => {
        if (!target || target.version === 'latest') return;
        const run = { cancelled: false };
        cachedPreview(target, locked)
            .then((value) => {
                if (!run.cancelled) setPreview({ key, value });
            })
            .catch(() => {});
        return () => {
            run.cancelled = true;
        };
    }, [key]);
    return preview?.key === key ? preview.value : undefined;
}
