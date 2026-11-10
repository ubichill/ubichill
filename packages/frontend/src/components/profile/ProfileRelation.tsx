import { HudIcon } from '@/components/hud/HudIcon';
import { socialButton } from '@/components/social/buttons';
import type { ProfileAction } from '@/lib/profileActions';
import { css, cx } from '@/styled-system/css';

/** バナーの左上: 相手との関係（フォローされている・フレンド・ブロック中）。 */
export function ProfileRelationBadges({ badges }: { badges: readonly string[] }) {
    if (badges.length === 0) return null;
    return (
        <span className={css({ display: 'flex', flexWrap: 'wrap', gap: '1.5' })}>
            {badges.map((label) => (
                <span key={label} className={badge}>
                    {label}
                </span>
            ))}
        </span>
    );
}

/** バナーの右上: 相手への操作（何を出すかは lib/profileActions.ts）。 */
export function ProfileRelationActions({
    actions,
    busy,
    friendError,
    onRun,
}: {
    actions: readonly ProfileAction[];
    busy: boolean;
    friendError: string | null;
    onRun: (action: ProfileAction) => void;
}) {
    return (
        <span className={css({ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '2' })}>
            {actions.map((action) =>
                action.kind === 'message' ? (
                    <button
                        key={action.kind}
                        type="button"
                        className={cx(socialButton({ tone: action.tone }), withIcon)}
                        onClick={() => onRun(action)}
                    >
                        <HudIcon name="message" size={14} />
                        {action.label}
                    </button>
                ) : (
                    <button
                        key={`${action.kind}-${action.kind === 'block' ? action.block : action.action}`}
                        type="button"
                        disabled={busy}
                        className={socialButton({ tone: action.tone })}
                        onClick={() => onRun(action)}
                    >
                        {action.label}
                    </button>
                ),
            )}
            {friendError && <span className={css({ fontSize: '12px', color: 'errorText' })}>{friendError}</span>}
        </span>
    );
}

const withIcon = css({ display: 'inline-flex', alignItems: 'center', gap: '1.5' });

const badge = css({
    px: '2.5',
    py: '1',
    borderRadius: '8px',
    bg: 'hudBg',
    color: 'hudText',
    fontSize: '12px',
    fontWeight: '700',
    backdropFilter: 'blur(4px)',
});
