import { parseAuthorAccount } from '@ubichill/shared';
import { css, cx } from '@/styled-system/css';

/**
 * 署名で確認できた作者アカウントを「@ID」と「@サーバー」に分けて表示する。
 * どのサーバーがこの作者の鍵を保証しているか（＝どこを信頼しているか）を見て分かるようにする。
 * metadata.author（作者の自己申告）ではなく、署名と WebFinger で確認できた値だけを渡すこと。
 */
export function AuthorAccountLabel({ author, className }: { author: string; className?: string }) {
    const account = parseAuthorAccount(author);
    if (!account) return null;
    return (
        <span
            title={`${account.domain} がこの作者の署名鍵を証明しています`}
            className={cx(css({ fontSize: '12px', color: 'textMuted', whiteSpace: 'nowrap' }), className)}
        >
            <span className={css({ color: 'text', fontWeight: '600' })}>@{account.handle}</span>
            <span>@{account.domain}</span>
        </span>
    );
}
