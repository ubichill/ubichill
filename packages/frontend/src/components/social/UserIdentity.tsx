import type { CustomEmoji } from '@ubichill/shared';
import type { ReactNode } from 'react';
import { EmojiText } from '@/components/ui/EmojiText';
import { css, cva } from '@/styled-system/css';
import { UserAvatar } from './UserAvatar';

/**
 * 人を表す顔・名前・2 行目（handle や一言）。行やカードの中に置く（並べ方と間は置く側の flex が決める）。
 * 名前と 2 行目はカスタム絵文字を画像にして出す。
 */
export function UserIdentity({
    user,
    sub,
    size = 'md',
    wrap = false,
    online,
}: {
    user: { name: string; image: string | null; emojis?: readonly CustomEmoji[] };
    /** 2 行目（`@handle`・一言など）。無ければ名前だけ */
    sub?: ReactNode;
    size?: 'sm' | 'md';
    /** 長い名前を省略せずに折り返す（管理画面のように全部読めないと困るところ） */
    wrap?: boolean;
    /** 渡すと顔の右下にオンラインの点を出す */
    online?: boolean;
}) {
    const avatar = <UserAvatar user={user} size={size} />;
    return (
        <>
            {online === undefined ? (
                avatar
            ) : (
                <span className={css({ position: 'relative', display: 'inline-flex', flexShrink: 0 })}>
                    {avatar}
                    {online && <span className={onlineDot} aria-hidden="true" />}
                </span>
            )}
            <span className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column' })}>
                <span className={name({ size, wrap })}>
                    <EmojiText text={user.name} emojis={user.emojis} />
                </span>
                {sub !== undefined && sub !== null && <span className={subLine({ wrap })}>{sub}</span>}
            </span>
        </>
    );
}

const clip = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

const name = cva({
    base: { fontSize: '14px', fontWeight: '700', color: 'text' },
    variants: {
        size: { sm: {}, md: {} },
        wrap: { true: { overflowWrap: 'anywhere' }, false: clip },
    },
    // 1 行に詰める小さい行（設定の一覧）は文字も一段小さく
    compoundVariants: [{ size: 'sm', wrap: false, css: { fontSize: '13px' } }],
});

const subLine = cva({
    base: { fontSize: '12px', color: 'textMuted' },
    variants: { wrap: { true: { overflowWrap: 'anywhere' }, false: clip } },
});

const onlineDot = css({
    position: 'absolute',
    right: '-1px',
    bottom: '-1px',
    w: '12px',
    h: '12px',
    borderRadius: 'full',
    bg: 'hudStatusOn',
    border: '2px solid',
    borderColor: 'surface',
});
