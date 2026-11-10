import type { PublicRole } from '@ubichill/shared';
import { css } from '@/styled-system/css';

/**
 * ロールの印。色は管理者が自由に選ぶので文字や地には使わず、丸い印にだけ使う（どの色でも名前が読める）。
 */
export function RoleBadge({ role }: { role: Pick<PublicRole, 'name' | 'color'> }) {
    return (
        <span className={badge}>
            <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" className={css({ flexShrink: 0 })}>
                <circle cx="4" cy="4" r="4" fill={role.color} />
            </svg>
            <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis' })}>{role.name}</span>
        </span>
    );
}

/** プロフィールの公開のロール（表示順）。 */
export function ProfileRoleBadges({ roles }: { roles: readonly PublicRole[] }) {
    if (roles.length === 0) return null;
    return (
        <ul aria-label="ロール" className={list}>
            {roles.map((role) => (
                <li key={role.id} className={css({ minW: 0, maxW: 'full' })}>
                    <RoleBadge role={role} />
                </li>
            ))}
        </ul>
    );
}

const list = css({ display: 'flex', flexWrap: 'wrap', gap: '1.5', mt: '-2' });

const badge = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1.5',
    maxW: 'full',
    px: '2',
    py: '0.5',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: 'full',
    bg: 'background',
    color: 'text',
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '1.6',
    whiteSpace: 'nowrap',
});
