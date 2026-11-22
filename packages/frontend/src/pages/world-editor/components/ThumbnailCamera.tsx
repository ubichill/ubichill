import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { uploadWorldAsset } from '@/lib/worlds/worldAssetsApi';
import { css } from '@/styled-system/css';
import { captureThumbnail } from '../lib/captureThumbnail';
import { moveFrame, type ShotInsets, thumbnailFrame } from '../lib/thumbnailShot';
import { editorButton } from '../recipes/button';
import { CameraIcon } from './hierarchy/hierarchyIcons';

/** 下に操作の帯を置くので、枠はその上に収める */
const FRAME_INSETS: ShotInsets = { top: 24, right: 24, bottom: 88, left: 24 };

export interface ThumbnailTaken {
    url: string;
    missingImages: number;
}

/**
 * ワールドの画面からサムネイルを撮る。16:9 の枠を出し、枠の外を暗くする。スクロールして枠に合わせ、「撮る」で枠の中を
 * 画像にしてこのサーバーに上げる。枠の層はポインターを通すので、撮る前にワールドをスクロールできる。
 */
export function ThumbnailCamera({
    target,
    onTaken,
    onCancel,
}: {
    /** 撮る要素（ワールドのプレビュー） */
    target: RefObject<HTMLElement | null>;
    onTaken: (taken: ThumbnailTaken) => void;
    onCancel: () => void;
}) {
    const layer = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [shooting, setShooting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const frame = useMemo(() => thumbnailFrame(size, FRAME_INSETS), [size]);

    useEffect(() => {
        const element = layer.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (shooting) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [shooting, onCancel]);

    const shoot = async () => {
        const element = target.current;
        if (!frame || !element || !layer.current) return;
        setShooting(true);
        setError(null);
        try {
            const inElement = moveFrame(frame, layer.current.getBoundingClientRect(), element.getBoundingClientRect());
            const shot = await captureThumbnail(element, inElement);
            const asset = await uploadWorldAsset(shot.file);
            onTaken({ url: asset.url, missingImages: shot.missingImages });
        } catch (e) {
            setError(e instanceof Error ? e.message : '撮れませんでした');
            setShooting(false);
        }
    };

    return (
        <div ref={layer} className={cameraLayer}>
            {frame && (
                <div
                    aria-hidden="true"
                    className={frameBox}
                    style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
                />
            )}
            <div className={cameraBar}>
                {error ? (
                    <p role="alert" className={css({ fontSize: '12px', color: 'errorLight', maxW: '360px' })}>
                        {error}
                    </p>
                ) : (
                    <p className={css({ fontSize: '12px', color: 'hudTextMuted' })}>枠の中をサムネイルにします</p>
                )}
                <button
                    type="button"
                    className={editorButton({ intent: 'secondary', size: 'md' })}
                    disabled={shooting}
                    onClick={onCancel}
                >
                    やめる
                </button>
                <button
                    type="button"
                    className={editorButton({ intent: 'primary', size: 'md' })}
                    disabled={shooting || !frame}
                    onClick={() => void shoot()}
                >
                    <CameraIcon />
                    {shooting ? '撮っています...' : '撮る'}
                </button>
            </div>
        </div>
    );
}

const cameraLayer = css({
    position: 'absolute',
    inset: 0,
    zIndex: 99500,
    overflow: 'hidden',
    pointerEvents: 'none',
});

const frameBox = css({
    position: 'absolute',
    borderRadius: '4px',
    outline: '2px solid token(colors.white)',
    boxShadow: '0 0 0 100vmax token(colors.hudBg)',
});

const cameraBar = css({
    position: 'absolute',
    left: '50%',
    bottom: '4',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '3',
    px: '4',
    py: '2.5',
    bg: 'hudPanel',
    border: '1px solid',
    borderColor: 'hudBorder',
    borderRadius: '12px',
    boxShadow: 'toast',
    pointerEvents: 'auto',
    whiteSpace: 'nowrap',
});
