'use client';

import type { RoomListItem } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface RoomCardProps {
    room: RoomListItem;
    onSelect: (roomId: string) => void;
}

export function RoomCard({ room, onSelect }: RoomCardProps) {
    return (
        <button
            type="button"
            onClick={() => onSelect(room.id)}
            className={css({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '16px',
                backgroundColor: 'white',
                border: '2px solid #e9ecef',
                borderRadius: '12px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                width: '100%',
                textAlign: 'left',
                _hover: {
                    borderColor: '#228BE6',
                    transform: 'translateY(-2px)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                },
            })}
        >
            <div
                className={css({
                    width: '100%',
                    height: '100px',
                    backgroundColor: room.thumbnail ? 'transparent' : '#f1f3f5',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px',
                })}
            >
                {room.thumbnail ? (
                    <img
                        src={room.thumbnail}
                        alt={room.displayName}
                        className={css({ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' })}
                    />
                ) : (
                    '🏠'
                )}
            </div>
            <h3
                className={css({
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#212529',
                    marginBottom: '4px',
                })}
            >
                {room.displayName}
            </h3>
            {room.description && (
                <p
                    className={css({
                        fontSize: '13px',
                        color: '#868e96',
                        lineHeight: '1.4',
                    })}
                >
                    {room.description}
                </p>
            )}
            <div
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '8px',
                    fontSize: '12px',
                    color: '#adb5bd',
                })}
            >
                <span>👥 {room.capacity.default}/{room.capacity.max}</span>
                <span>v{room.version}</span>
            </div>
        </button>
    );
}
