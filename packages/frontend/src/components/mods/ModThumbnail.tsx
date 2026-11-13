import type { ModLockEntry } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import { type ModThumbnailTarget, modThumbnailSource } from '@/lib/mods/modThumbnail';
import { editorPackageBytes } from '@/lib/mods/packages';
import type { PreviewImageSource } from '@/lib/mods/previewImage';
import { css, cx } from '@/styled-system/css';
import { PreviewImage } from './PreviewImage';

const thumbBox = css({
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: '4px',
    bg: 'surface',
    color: 'textSubtle',
});
const small = css({ width: '32px', height: '32px' });
const large = css({ width: '64px', height: '64px' });

const cache = new Map<string, Promise<PreviewImageSource | undefined>>();

/** 同じ mod の同じ版は 1 回だけ調べる（失敗は覚えない）。 */
function cachedSource(target: ModThumbnailTarget, locked?: ModLockEntry) {
    const key = `${target.baseUrl ?? ''} ${target.id} ${target.version}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = modThumbnailSource(target, { fallbackBase: MOD_CDN_URL, fetchBytes: editorPackageBytes, locked });
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
    return pending;
}

/** mod のサムネイル。その版の manifest と画像の hash を確かめてから出し、無ければ印を出す。 */
export function ModThumbnail({
    target,
    locked,
    size = 32,
}: {
    target: ModThumbnailTarget | undefined;
    locked?: ModLockEntry;
    size?: 32 | 64;
}) {
    const [source, setSource] = useState<{ key: string; value: PreviewImageSource | undefined } | null>(null);
    const key = target ? `${target.baseUrl ?? ''} ${target.id} ${target.version}` : '';
    // biome-ignore lint/correctness/useExhaustiveDependencies: target・locked の同一性は key で決める
    useEffect(() => {
        if (!target || target.version === 'latest') return;
        const run = { cancelled: false };
        cachedSource(target, locked)
            .then((value) => {
                if (!run.cancelled) setSource({ key, value });
            })
            .catch(() => {});
        return () => {
            run.cancelled = true;
        };
    }, [key]);
    return (
        <span className={cx(thumbBox, size === 64 ? large : small)}>
            <PreviewImage source={source?.key === key ? source.value : undefined} alt="" fallback={<ModGlyph />} />
        </span>
    );
}

function ModGlyph() {
    return (
        <svg
            width="60%"
            height="60%"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
        >
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
            <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
    );
}
