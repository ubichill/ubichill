import type { WorldIdentity } from '@ubichill/shared';
import { cva, cx } from '@/styled-system/css';

const badge = cva({
    base: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '6px',
        py: '2px',
        borderRadius: '4px',
        fontSize: '11px',
        whiteSpace: 'nowrap',
    },
    variants: {
        status: {
            verified: { bg: 'successBg', color: 'successText' },
            unsigned: { bg: 'surfaceAccent', color: 'textSubtle' },
        },
    },
});

/**
 * 作者署名の検証結果。identity が無い（連合ピア一覧など未検証の自己申告）ときは何も出さない。
 * title に worldId を出し、同名の別作者ワールドと見分けられるようにする。
 */
export function WorldIdentityBadge({ identity, className }: { identity?: WorldIdentity; className?: string }) {
    if (!identity) return null;
    const verified = identity.status === 'verified';
    return (
        <span
            className={cx(badge({ status: identity.status }), className)}
            title={verified ? identity.worldId : '作者の署名がありません。配信元を信頼できる場合のみ入室してください'}
        >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
                {verified && <path d="M9 12l2 2 4-4" />}
            </svg>
            {verified ? '検証済み' : '未検証'}
        </span>
    );
}
