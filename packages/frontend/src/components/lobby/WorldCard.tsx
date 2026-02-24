'use client';

import type { WorldListItem } from '@ubichill/shared';
import Image from 'next/image';
import { css } from '@/styled-system/css';

interface WorldCardProps {
    world: WorldListItem;
    onSelect: (worldId: string) => void;
}

const cardStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: '16px',
    backgroundColor: '#1d3054',
    border: '1px solid rgba(230, 216, 197, 0.2)',
    borderRadius: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, border-color 0.16s ease',
    width: '100%',
    textAlign: 'left',
    _hover: {
        borderColor: 'rgba(230, 216, 197, 0.45)',
        backgroundColor: '#253b66',
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
    color: '#e9ddcb',
    marginBottom: '4px',
};

const descriptionStyle = {
    fontSize: '13px',
    color: '#d8cfbf',
    lineHeight: '1.4',
};

const metaStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
    fontSize: '12px',
    color: '#bdc8e0',
};

export function WorldCard({ world, onSelect }: WorldCardProps) {
    return (
        <button type="button" onClick={() => onSelect(world.id)} className={css(cardStyle)}>
            <div
                className={css({
                    ...thumbnailContainerStyle,
                    backgroundColor: world.thumbnail ? 'transparent' : '#243b66',
                })}
            >
                {world.thumbnail ? (
                    <Image
                        src={world.thumbnail}
                        alt={world.displayName}
                        fill
                        className={css({ objectFit: 'cover' })}
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                ) : (
                    '🌍'
                )}
            </div>
            <h3 className={css(titleStyle)}>{world.displayName}</h3>
            {world.description && <p className={css(descriptionStyle)}>{world.description}</p>}
            <div className={css(metaStyle)}>
                <span>
                    👥 推奨: {world.capacity.default}人 / 最大: {world.capacity.max}人
                </span>
                <span>v{world.version}</span>
            </div>
        </button>
    );
}
