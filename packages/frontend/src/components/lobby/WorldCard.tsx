import type { WorldListItem } from '@ubichill/shared';
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

export function WorldCard({ world, onSelect }: WorldCardProps) {
    return (
        <button type="button" onClick={() => onSelect(world.id)} className={css(cardStyle)}>
            <div
                className={css({
                    ...thumbnailContainerStyle,
                    backgroundColor: world.thumbnail ? 'transparent' : '#f1f3f5',
                })}
            >
                {world.thumbnail ? (
                    <img
                        src={world.thumbnail}
                        alt={world.displayName}
                        className={css({ objectFit: 'cover', width: '100%', height: '100%' })}
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
