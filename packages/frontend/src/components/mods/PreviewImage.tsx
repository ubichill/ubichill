import { type ReactNode, useEffect, useState } from 'react';
import { type PreviewImageSource, verifiedImageUrl } from '@/lib/mods/previewImage';
import { css, cx } from '@/styled-system/css';

const imageStyle = css({ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' });

/** mod の見た目の画像。hash を確かめられたものだけを出し、それまで・確かめられないときは fallback を出す。 */
export function PreviewImage({
    source,
    alt,
    fallback,
    className,
}: {
    source: PreviewImageSource | undefined;
    alt: string;
    fallback: ReactNode;
    className?: string;
}) {
    const url = useVerifiedImageUrl(source);
    return url ? <img src={url} alt={alt} className={cx(imageStyle, className)} /> : fallback;
}

function useVerifiedImageUrl(source: PreviewImageSource | undefined): string | null {
    const [loaded, setLoaded] = useState<{ integrity: string; url: string } | null>(null);
    const integrity = source?.integrity;
    // 同じ画像（同じ hash）なら取り直さない。source のオブジェクトが作り直されても integrity で同じと分かる
    // biome-ignore lint/correctness/useExhaustiveDependencies: source の同一性は integrity で決める
    useEffect(() => {
        if (!source) return;
        const run = { cancelled: false };
        verifiedImageUrl(source)
            .then((url) => {
                if (!run.cancelled) setLoaded({ integrity: source.integrity, url });
            })
            .catch(() => {});
        return () => {
            run.cancelled = true;
        };
    }, [integrity]);
    return loaded && loaded.integrity === integrity ? loaded.url : null;
}
