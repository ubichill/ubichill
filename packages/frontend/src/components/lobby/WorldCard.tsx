import { type WorldListItem, worldSourceLabel } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface WorldCardProps {
    world: WorldListItem;
    onNavigate: (worldId: string) => void;
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

export function WorldCard({ world, onNavigate }: WorldCardProps) {
    return (
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
                {/* どのサーバー/由来のワールドか（このインスタンス / GitHub / 外部ホスト等） */}
                <span
                    className={css({
                        ml: 'auto',
                        px: '6px',
                        py: '2px',
                        bg: 'primarySubtle',
                        borderRadius: '4px',
                        fontSize: '11px',
                        color: 'textMuted',
                        maxWidth: '160px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    })}
                    title={world.source.originInstance ?? world.source.url}
                >
                    {worldSourceLabel(world.source)}
                </span>
            </div>
        </button>
    );
}
