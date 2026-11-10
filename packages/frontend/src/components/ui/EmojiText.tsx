import { type CustomEmoji, splitCustomEmojis } from '@ubichill/shared';
import { css } from '@/styled-system/css';

const emoji = css({
    display: 'inline-block',
    h: '1.25em',
    w: 'auto',
    maxW: '3em',
    verticalAlign: '-0.25em',
    objectFit: 'contain',
});

/**
 * 文字の中の `:name:` を、その人のサーバーのカスタム絵文字の画像にして出す（知らない名前は文字のまま）。
 * 画像はほかのサーバーにあるので、開いたページを Referer で渡さない。
 */
export function EmojiText({ text, emojis }: { text: string; emojis?: readonly CustomEmoji[] }) {
    return (
        <>
            {splitCustomEmojis(text, emojis).map((part, i) =>
                part.kind === 'emoji' ? (
                    <img
                        key={i}
                        src={part.url}
                        alt={`:${part.name}:`}
                        title={`:${part.name}:`}
                        className={emoji}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                    />
                ) : (
                    part.text
                ),
            )}
        </>
    );
}
