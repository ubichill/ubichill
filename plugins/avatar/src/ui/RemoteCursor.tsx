import type { RemoteUser } from '../types';

export interface RemoteCursorProps {
    user: RemoteUser;
}

export const RemoteCursor = ({ user }: RemoteCursorProps) => {
    const cursorState = user.cursorState ?? 'default';
    const avatarState =
        user.avatar?.states[cursorState as keyof typeof user.avatar.states] ?? user.avatar?.states.default;
    const url = avatarState?.url;
    const hotspot = avatarState?.hotspot ?? { x: 0, y: 0 };
    const sx = user.position.x - hotspot.x;
    const sy = user.position.y - hotspot.y;
    return (
        <div style={{ position: 'fixed', left: sx, top: sy, pointerEvents: 'none', zIndex: 10000 }}>
            {user.penColor && (
                <div
                    style={{
                        position: 'absolute',
                        top: '-6px',
                        left: '-6px',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        backgroundColor: user.penColor,
                        border: '2px solid white',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                    }}
                />
            )}
            {user.status === 'busy' && (
                <div
                    style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: '#fa5252',
                        border: '2px solid white',
                    }}
                />
            )}
            {url ? (
                <img src={url} alt={user.name} style={{ maxWidth: '64px', maxHeight: '64px', display: 'block' }} />
            ) : (
                <div
                    style={{
                        backgroundColor: '#4263eb',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        whiteSpace: 'nowrap',
                    }}
                >
                    {user.name}
                </div>
            )}
            <span
                style={{
                    display: 'block',
                    position: 'absolute',
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginTop: '4px',
                    whiteSpace: 'nowrap',
                    fontSize: '12px',
                    background: 'rgba(0,0,0,0.7)',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                }}
            >
                {user.name}
            </span>
        </div>
    );
};
