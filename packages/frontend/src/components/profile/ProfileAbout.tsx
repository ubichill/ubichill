import type { CustomEmoji, RichSegment } from '@ubichill/shared';
import { type MouseEvent, useState } from 'react';
import { useOpenAccount } from '@/components/social/useOpenAccount';
import { EmojiText } from '@/components/ui/EmojiText';
import { shouldCollapseBio } from '@/lib/profile/bioCollapse';
import { bioPieces } from '@/lib/profile/bioLinks';
import { css, cva } from '@/styled-system/css';
import { profileSectionTitle } from './profileStyles';

const text = cva({
    base: {
        fontSize: '14px',
        color: 'text',
        lineHeight: '1.75',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
    },
    variants: { collapsed: { true: { lineClamp: 4 } } },
});
const link = css({ color: 'primaryHighlight', textDecoration: 'underline', _hover: { opacity: 0.8 } });
const more = css({
    mt: '1',
    p: 0,
    bg: 'transparent',
    border: 'none',
    color: 'primaryHighlight',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    _hover: { textDecoration: 'underline' },
});

// 新しいタブ・ウィンドウで開く操作はブラウザに任せる
const opensElsewhere = (e: MouseEvent) => e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;

/**
 * 自己紹介。長ければ最初は折りたたみ「続きを読む」で開く。ほかのサーバーの人は、取り込んだリンク（文字と行き先が違うもの）・
 * メンション（押すとこのサーバーでその人のプロフィール）・カスタム絵文字も出す。
 */
export function ProfileAbout({
    bio,
    segments,
    emojis,
}: {
    bio: string | null;
    segments?: readonly RichSegment[];
    emojis?: readonly CustomEmoji[];
}) {
    const openAccount = useOpenAccount();
    const [expanded, setExpanded] = useState(false);
    const collapsible = !!bio && shouldCollapseBio(bio);
    const collapsed = collapsible && !expanded;
    return (
        <section>
            <h2 className={profileSectionTitle}>自己紹介</h2>
            {bio ? (
                <>
                    <p className={text({ collapsed })}>
                        {bioPieces(bio, segments).map((s, i) => {
                            const text = <EmojiText text={s.text} emojis={emojis} />;
                            if (s.kind === 'text') return <span key={i}>{text}</span>;
                            if (s.kind === 'mention' && s.account) {
                                const account = s.account;
                                return (
                                    <a
                                        key={i}
                                        href={`/@${account}`}
                                        title={`@${account}`}
                                        className={link}
                                        onClick={(e) => {
                                            if (opensElsewhere(e)) return;
                                            e.preventDefault();
                                            void openAccount(account);
                                        }}
                                    >
                                        {text}
                                    </a>
                                );
                            }
                            return (
                                // 自己紹介はだれでも書けるので、開いた先に元のページを触らせず、リンクの評価も渡さない
                                <a
                                    key={i}
                                    href={s.href}
                                    title={s.href}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow ugc"
                                    className={link}
                                >
                                    {text}
                                </a>
                            );
                        })}
                    </p>
                    {collapsible && (
                        <button
                            type="button"
                            className={more}
                            aria-expanded={expanded}
                            onClick={() => setExpanded((v) => !v)}
                        >
                            {expanded ? '閉じる' : '続きを読む'}
                        </button>
                    )}
                </>
            ) : (
                <p className={css({ fontSize: '13px', color: 'textMuted' })}>自己紹介はまだ書いていないようです。</p>
            )}
        </section>
    );
}
