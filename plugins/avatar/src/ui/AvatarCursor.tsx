interface CursorImageProps {
    viewportX: number;
    viewportY: number;
    url: string;
    hotspot?: { x: number; y: number };
    zIndex: number;
}

export const CursorImage = ({ viewportX, viewportY, url, hotspot, zIndex }: CursorImageProps) => {
    const hx = hotspot?.x ?? 0;
    const hy = hotspot?.y ?? 0;
    return (
        <div
            style={{
                position: 'fixed',
                left: viewportX - hx,
                top: viewportY - hy,
                pointerEvents: 'none',
                zIndex,
                willChange: 'transform',
            }}
        >
            <img src={url} alt="" style={{ maxWidth: '64px', maxHeight: '64px', display: 'block' }} />
        </div>
    );
};
