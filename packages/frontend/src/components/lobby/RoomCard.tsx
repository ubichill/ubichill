'use client';

import type { RoomListItem } from '@ubichill/shared';
import Image from 'next/image';
import { css } from '@/styled-system/css';

interface RoomCardProps {
    room: RoomListItem;
    onSelect: (roomId: string) => void;
}

const cardStyle = {
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
};

const thumbnailContainerStyle = {
    width: '100%',
    height: '100px',
    borderRadius: '8px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '32px',
    position: 'relative',
    overflow: 'hidden',
};

const titleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: '#212529',
    marginBottom: '4px',
};

const descriptionStyle = {
    fontSize: '13px',
    color: '#868e96',
    lineHeight: '1.4',
};

const metaStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
    fontSize: '12px',
    color: '#adb5bd',
};

export function RoomCard({ room, onSelect }: RoomCardProps) {
    return (
        <button type="button" onClick={() => onSelect(room.id)} className={css(cardStyle)}>
            <div
                className={css({
                    ...thumbnailContainerStyle,
                    backgroundColor: room.thumbnail ? 'transparent' : '#f1f3f5',
                })}
            >
                {room.thumbnail ? (
                    <Image
                        src={room.thumbnail}
                        alt={room.displayName}
                        fill
                        className={css({ objectFit: 'cover' })}
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                ) : (
                    '🏠'
                )}
            </div>
            <h3 className={css(titleStyle)}>{room.displayName}</h3>
            {room.description && <p className={css(descriptionStyle)}>{room.description}</p>}
            <div className={css(metaStyle)}>
                <span>
                    👥 {room.capacity.default}/{room.capacity.max}
                </span>
                <span>v{room.version}</span>
            </div>
        </button>
    );
}
