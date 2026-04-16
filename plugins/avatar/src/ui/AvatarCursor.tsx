import { cursorZIndex, lerpViewportX, lerpViewportY, localAvatar, localCursorStyle } from '../state';
import { cssToState } from '../systems/utils';

export const AvatarCursor = () => {
    const cursorState = cssToState(localCursorStyle);
    const stateDef = localAvatar.states[cursorState as keyof typeof localAvatar.states] ?? localAvatar.states.default;
    if (!stateDef?.url) return null;
    const hx = stateDef.hotspot?.x ?? 0;
    const hy = stateDef.hotspot?.y ?? 0;
    return (
        <div
            style={{
                position: 'fixed',
                left: lerpViewportX - hx,
                top: lerpViewportY - hy,
                pointerEvents: 'none',
                zIndex: cursorZIndex,
                willChange: 'transform',
            }}
        >
            <img src={stateDef.url} alt="cursor" style={{ maxWidth: '64px', maxHeight: '64px', display: 'block' }} />
        </div>
    );
};
