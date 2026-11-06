import { CreateAnnouncementRequestSchema, NOTIFICATION_LIMITS } from '@ubichill/shared';
import { useState } from 'react';
import { createAnnouncement } from '@/lib/notificationsApi';
import { css, cva } from '@/styled-system/css';

const field = cva({
    base: {
        width: 'full',
        px: '3',
        py: '2',
        border: '1px solid',
        borderColor: 'border',
        borderRadius: '8px',
        fontSize: '14px',
        bg: 'background',
        color: 'text',
    },
    variants: { multiline: { true: { minHeight: '120px', resize: 'vertical' } } },
});

const submit = cva({
    base: {
        padding: '8px 14px',
        border: '1px solid',
        borderColor: 'primary',
        borderRadius: '10px',
        bg: 'primary',
        color: 'textOnPrimary',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        _hover: { opacity: 0.9 },
        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
    },
});

/** 運営のお知らせを出す（公式アカウントだけに見せる。サーバーも公式アカウント以外を断る）。全員の通知に届く。 */
export function AnnouncementSection() {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
    const valid = CreateAnnouncementRequestSchema.safeParse({ title, content }).success;

    const send = async () => {
        setBusy(true);
        setMessage(null);
        try {
            await createAnnouncement({ title: title.trim(), content: content.trim() });
            setTitle('');
            setContent('');
            setMessage({ tone: 'ok', text: 'お知らせを出しました' });
        } catch (e) {
            setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'お知らせを出せませんでした' });
        } finally {
            setBusy(false);
        }
    };

    return (
        <form
            className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}
            onSubmit={(e) => {
                e.preventDefault();
                if (valid && !busy) void send();
            }}
        >
            <p className={css({ fontSize: '13px', color: 'textMuted' })}>
                全員の通知に届きます。出したあとは取り消せません（{NOTIFICATION_LIMITS.RETENTION_DAYS} 日で消えます）。
            </p>
            <label className={css({ display: 'flex', flexDirection: 'column', gap: '1', fontSize: '13px' })}>
                題名
                <input
                    className={field()}
                    value={title}
                    maxLength={NOTIFICATION_LIMITS.ANNOUNCEMENT_TITLE_MAX}
                    onChange={(e) => setTitle(e.target.value)}
                />
            </label>
            <label className={css({ display: 'flex', flexDirection: 'column', gap: '1', fontSize: '13px' })}>
                本文
                <textarea
                    className={field({ multiline: true })}
                    value={content}
                    maxLength={NOTIFICATION_LIMITS.ANNOUNCEMENT_CONTENT_MAX}
                    onChange={(e) => setContent(e.target.value)}
                />
            </label>
            {message && (
                <p
                    role="status"
                    className={css({ fontSize: '13px', color: message.tone === 'ok' ? 'successText' : 'errorText' })}
                >
                    {message.text}
                </p>
            )}
            <div className={css({ display: 'flex', justifyContent: 'flex-end' })}>
                <button type="submit" className={submit()} disabled={!valid || busy}>
                    お知らせを出す
                </button>
            </div>
        </form>
    );
}
