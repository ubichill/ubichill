import type { CustomEmoji, ProfileField } from '@ubichill/shared';
import { EmojiText } from '@/components/ui/EmojiText';
import { css } from '@/styled-system/css';
import { profileSectionTitle } from './profileStyles';

const list = css({
    display: 'grid',
    gridTemplateColumns: 'minmax(0, max-content) minmax(0, 1fr)',
    columnGap: '4',
    rowGap: '1.5',
    m: 0,
    fontSize: '14px',
    lineHeight: '1.6',
});
const term = css({ color: 'textMuted', fontWeight: '700', overflowWrap: 'anywhere' });
const detail = css({ m: 0, color: 'text', overflowWrap: 'anywhere' });
const link = css({ color: 'primaryHighlight', textDecoration: 'underline', _hover: { opacity: 0.8 } });

/** ほかのサーバーの人の項目の表（Mastodon・Misskey の補足情報。リンクのボタンに入りきらなかったリンクも、ここでリンクにする）。 */
export function ProfileFieldsTable({
    fields,
    emojis,
}: {
    fields: readonly ProfileField[] | undefined;
    emojis?: readonly CustomEmoji[];
}) {
    if (!fields || fields.length === 0) return null;
    return (
        <section>
            <h2 className={profileSectionTitle}>補足情報</h2>
            <dl className={list}>
                {fields.map((field) => (
                    // 同じ名前と値の組は shared の remoteProfileView で 1 つにしてある
                    <div key={`${field.name}\n${field.value}`} className={css({ display: 'contents' })}>
                        <dt className={term}>
                            <EmojiText text={field.name} emojis={emojis} />
                        </dt>
                        <dd className={detail}>
                            {field.href ? (
                                <a
                                    href={field.href}
                                    title={field.href}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow ugc"
                                    className={link}
                                >
                                    <EmojiText text={field.value} emojis={emojis} />
                                </a>
                            ) : (
                                <EmojiText text={field.value} emojis={emojis} />
                            )}
                        </dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
