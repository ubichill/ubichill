import { useSocket } from '@ubichill/sdk';
import type { CursorState, UserStatus } from '@ubichill/shared';
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

export interface AvatarCursorProps {
    cursorState: CursorState;
    userStatus: UserStatus;
    mousePosition: { x: number; y: number };
    canvasOffset?: { left: number; top: number };
    showRadialMenu?: boolean;
}

/**
 * AvatarCursor - Handles the local user's custom cursor rendering and logic.
 */
export const AvatarCursor: React.FC<AvatarCursorProps> = ({
    cursorState,
    userStatus,
    mousePosition,
    canvasOffset: _canvasOffset = { left: 0, top: 0 },
    showRadialMenu = false,
}) => {
    const { currentUser } = useSocket();
    const [fixedAvatarPosition, setFixedAvatarPosition] = useState<{ x: number; y: number } | null>(null);
    const previousStatusRef = useRef<UserStatus>(userStatus);
    const previousMenuRef = useRef<boolean>(showRadialMenu);
    const cursorRef = useRef<HTMLDivElement>(null);

    // Initial mouse position sync
    const [smoothPosition, setSmoothPosition] = useState(mousePosition);

    // Sync position with mouse or fixed status
    useEffect(() => {
        // Handle busy status - lock cursor position
        if (userStatus === 'busy' && previousStatusRef.current !== 'busy') {
            setFixedAvatarPosition({ ...mousePosition });
        } else if (userStatus !== 'busy' && previousStatusRef.current === 'busy') {
            setFixedAvatarPosition(null);
        }

        previousStatusRef.current = userStatus;
    }, [userStatus, mousePosition]);

    // Handle radial menu - lock cursor position
    useEffect(() => {
        // When menu opens, lock position
        if (showRadialMenu && !previousMenuRef.current) {
            setFixedAvatarPosition({ ...mousePosition });
        }
        // When menu closes, unlock if not busy
        else if (!showRadialMenu && previousMenuRef.current && userStatus !== 'busy') {
            setFixedAvatarPosition(null);
        }

        previousMenuRef.current = showRadialMenu;
    }, [showRadialMenu, mousePosition, userStatus]);

    // Animation loop for smooth cursor movement
    useEffect(() => {
        let animationFrameId: number;

        const animate = () => {
            const targetPos =
                (userStatus === 'busy' || showRadialMenu) && fixedAvatarPosition ? fixedAvatarPosition : mousePosition;

            setSmoothPosition((prev) => {
                // Simple lerp for smoothness
                const lerpFactor = 0.3; // Higher value = faster follow
                const x = prev.x + (targetPos.x - prev.x) * lerpFactor;
                const y = prev.y + (targetPos.y - prev.y) * lerpFactor;

                // If very close, snap to target to avoid jitter
                if (Math.abs(targetPos.x - x) < 0.1 && Math.abs(targetPos.y - y) < 0.1) {
                    return targetPos;
                }
                return { x, y };
            });

            animationFrameId = requestAnimationFrame(animate);
        };

        animationFrameId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [mousePosition, userStatus, fixedAvatarPosition, showRadialMenu]);

    // Determine current avatar image and hotspot
    const localAvatar = currentUser?.avatar || { states: {} };
    const currentLocalAvatar = localAvatar.states[cursorState] || localAvatar.states.default;
    const localAvatarUrl = currentLocalAvatar?.url;
    const localHotspot = currentLocalAvatar?.hotspot || { x: 0, y: 0 };

    // Hide system cursor logic
    useEffect(() => {
        if (localAvatarUrl && localAvatar.hideSystemCursor) {
            document.body.classList.add('cursor-hidden');
            let style = document.getElementById('cursor-none-style') as HTMLStyleElement | null;
            if (!style) {
                style = document.createElement('style');
                style.id = 'cursor-none-style';
                style.innerHTML = `
                    body.cursor-hidden * {
                        cursor: none !important;
                    }
                `;
                document.head.appendChild(style);
            }
        } else {
            document.body.classList.remove('cursor-hidden');
        }

        return () => {
            document.body.classList.remove('cursor-hidden');
            const existingStyle = document.getElementById('cursor-none-style');
            if (existingStyle) existingStyle.remove();
        };
    }, [localAvatarUrl, localAvatar.hideSystemCursor]);

    if (!localAvatarUrl) return null;

    return (
        <div
            ref={cursorRef}
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                transform: `translate3d(${smoothPosition.x - localHotspot.x}px, ${smoothPosition.y - localHotspot.y}px, 0)`,
                pointerEvents: 'none',
                zIndex: 9999,
                willChange: 'transform',
            }}
        >
            <img
                src={localAvatarUrl}
                alt="avatar cursor"
                style={{
                    maxWidth: '64px',
                    maxHeight: '64px',
                    width: 'auto',
                    height: 'auto',
                    display: 'block',
                }}
            />
            {userStatus === 'busy' && (
                <div
                    style={{
                        position: 'absolute',
                        top: '-8px',
                        right: '-8px',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        backgroundColor: '#fa5252',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    }}
                >
                    🔴
                </div>
            )}
        </div>
    );
};
