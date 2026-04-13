import { cursorZIndex, lerpX, lerpY, localAvatar, localCursorStyle, localStatus } from '../state';
import { cssToState } from '../systems/AvatarMainSystem';

export const LocalCursor = () => {
    const cursorState = cssToState(localCursorStyle);
    const stateDef = localAvatar.states[cursorState as keyof typeof localAvatar.states] ?? localAvatar.states.default;
    if (!stateDef?.url) return null;
    const hx = stateDef.hotspot?.x ?? 0;
    const hy = stateDef.hotspot?.y ?? 0;
    return (
        <div
            style={{
                position: 'fixed',
                left: lerpX - hx,
                top: lerpY - hy,
                pointerEvents: 'none',
                zIndex: cursorZIndex,
                willChange: 'transform',
            }}
        >
            <img src={stateDef.url} alt="cursor" style={{ maxWidth: '64px', maxHeight: '64px', display: 'block' }} />
            {localStatus === 'busy' && (
                <div
                    style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        backgroundColor: '#fa5252',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '10px',
                    }}
                >
                    🔴
                </div>
            )}
        </div>
    );
};
