import { cursor } from '../state';
import { cssToState } from '../systems/utils';

export const AvatarCursor = () => {
    const state = cssToState(cursor.cursorStyle);
    const stateDef = cursor.avatar.states[state as keyof typeof cursor.avatar.states] ?? cursor.avatar.states.default;
    if (!stateDef?.url) return null;
    const hx = stateDef.hotspot?.x ?? 0;
    const hy = stateDef.hotspot?.y ?? 0;
    return (
        <div
            style={{
                position: 'fixed',
                left: cursor.lerpViewportX - hx,
                top: cursor.lerpViewportY - hy,
                pointerEvents: 'none',
                zIndex: cursor.zIndex,
                willChange: 'transform',
            }}
        >
            <img src={stateDef.url} alt="cursor" style={{ maxWidth: '64px', maxHeight: '64px', display: 'block' }} />
        </div>
    );
};
