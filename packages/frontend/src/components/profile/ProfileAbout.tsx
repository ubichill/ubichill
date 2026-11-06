import { useState } from 'react';
import { bioSegments } from '@/lib/bioLinks';
import { shouldCollapseBio } from '@/lib/profile/bioCollapse';
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

/** 自己紹介。長ければ最初は折りたたみ「続きを読む」で開く。 */
export function ProfileAbout({ bio }: { bio: string | null }) {
    const [expanded, setExpanded] = useState(false);
    const collapsible = !!bio && shouldCollapseBio(bio);
    const collapsed = collapsible && !expanded;
    return (
        <section>
            <h2 className={profileSectionTitle}>自己紹介</h2>
            {bio ? (
                <>
                    <p className={text({ collapsed })}>
                        {bioSegments(bio).map((s, i) =>
                            s.kind === 'link' ? (
                                // 自己紹介はだれでも書けるので、開いた先に元のページを触らせず、リンクの評価も渡さない
                                <a
                                    key={i}
                                    href={s.href}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow ugc"
                                    className={link}
                                >
                                    {s.text}
                                </a>
                            ) : (
                                <span key={i}>{s.text}</span>
                            ),
                        )}
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
