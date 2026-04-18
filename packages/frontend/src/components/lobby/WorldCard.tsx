import type { WorldListItem } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface WorldCardProps {
    world: WorldListItem;
    onNavigate: (worldId: string) => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    isFirst?: boolean;
    isLast?: boolean;
}

const cardStyle = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: '16px',
    backgroundColor: 'surface',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '14px',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, border-color 0.16s ease',
    width: '100%',
    textAlign: 'left',
    _hover: {
        borderColor: 'borderStrong',
        backgroundColor: 'surfaceHover',
    },
});

const titleStyle = css({
    fontSize: '16px',
    fontWeight: '600',
    color: 'text',
    marginBottom: '4px',
});

const descriptionStyle = css({
    fontSize: '13px',
    color: 'textMuted',
    lineHeight: '1.4',
});

const metaStyle = css({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '8px',
    fontSize: '12px',
    color: 'textSubtle',
});

export function WorldCard({ world, onNavigate, onMoveUp, onMoveDown, isFirst, isLast }: WorldCardProps) {
    const showReorder = onMoveUp !== undefined || onMoveDown !== undefined;

    return (
        <div className={css({ position: 'relative' })}>
            {showReorder && (
                <div
                    className={css({
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        display: 'flex',
                        flexDir: 'column',
                        gap: '2px',
                        zIndex: 1,
                    })}
                >
                    <button
                        type="button"
                        disabled={isFirst}
                        onClick={(e) => {
                            e.stopPropagation();
                            onMoveUp?.();
                        }}
                        className={css({
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bg: 'surfaceAccent',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            color: 'textMuted',
                            _disabled: { opacity: 0.3, cursor: 'not-allowed' },
                            _hover: { borderColor: 'borderStrong' },
                        })}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M2 8l4-4 4 4" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        disabled={isLast}
                        onClick={(e) => {
                            e.stopPropagation();
                            onMoveDown?.();
                        }}
                        className={css({
                            width: '24px',
                            height: '24px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bg: 'surfaceAccent',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            color: 'textMuted',
                            _disabled: { opacity: 0.3, cursor: 'not-allowed' },
                            _hover: { borderColor: 'borderStrong' },
                        })}
                    >
                        <svg
                            width="12"
                            height="12"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M2 4l4 4 4-4" />
                        </svg>
                    </button>
                </div>
            )}
            <button type="button" onClick={() => onNavigate(world.id)} className={cardStyle}>
                <div
                    className={css({
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
                        backgroundColor: world.thumbnail ? 'transparent' : 'secondary',
                    })}
                >
                    {world.thumbnail ? (
                        <img
                            src={world.thumbnail}
                            alt={world.displayName}
                            className={css({ objectFit: 'cover', width: '100%', height: '100%' })}
                        />
                    ) : (
                        <svg
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            className={css({ color: 'textSubtle' })}
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                    )}
                </div>
                <h3 className={titleStyle}>{world.displayName}</h3>
                {world.description && <p className={descriptionStyle}>{world.description}</p>}
                <div className={metaStyle}>
                    <span>
                        {world.capacity.default}〜{world.capacity.max}人
                    </span>
                    <span>v{world.version}</span>
                </div>
            </button>
        </div>
    );
}
