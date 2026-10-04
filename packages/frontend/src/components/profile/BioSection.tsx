import { BIO_MAX_LENGTH } from '@ubichill/shared';
import { useState } from 'react';
import { setMyBio } from '@/lib/account/me';
import { css } from '@/styled-system/css';

const text = css({
    fontSize: '14px',
    color: 'text',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
});
const empty = css({ fontSize: '13px', color: 'textMuted' });
const linkButton = css({
    mt: '1',
    fontSize: '12px',
    color: 'textMuted',
    bg: 'transparent',
    border: 'none',
    p: 0,
    cursor: 'pointer',
    textDecoration: 'underline',
});

/**
 * 自己紹介。書いていなければ「まだ書いていない」と出す。本人は書き直せる（空にすると書いていない状態に戻る）。
 * リンクのプレビューの説明にも使われる。
 */
export function BioSection({
    bio,
    editable,
    onChanged,
}: {
    bio: string | null;
    editable: boolean;
    onChanged: (bio: string | null) => void;
}) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(bio ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const length = Array.from(value.trim()).length;

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            onChanged((await setMyBio(value)).bio);
            setEditing(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : '保存できませんでした');
        } finally {
            setBusy(false);
        }
    };

    if (!editing) {
        return (
            <div className={css({ mt: '3' })}>
                {bio ? <p className={text}>{bio}</p> : <p className={empty}>自己紹介はまだ書いていないようです。</p>}
                {editable && (
                    <button
                        type="button"
                        className={linkButton}
                        onClick={() => {
                            setValue(bio ?? '');
                            setEditing(true);
                        }}
                    >
                        {bio ? '自己紹介を書き直す' : '自己紹介を書く'}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className={css({ mt: '3' })}>
            <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={4}
                aria-label="自己紹介"
                placeholder="どんなワールドを作っているか、好きなことなど"
                className={css({
                    width: 'full',
                    px: '3',
                    py: '2',
                    border: '1px solid',
                    borderColor: length > BIO_MAX_LENGTH ? 'errorText' : 'border',
                    borderRadius: '8px',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    bg: 'background',
                    color: 'text',
                    resize: 'vertical',
                })}
            />
            <div className={css({ display: 'flex', alignItems: 'center', gap: '2', mt: '1', flexWrap: 'wrap' })}>
                <span className={css({ fontSize: '12px', color: length > BIO_MAX_LENGTH ? 'errorText' : 'textMuted' })}>
                    {length} / {BIO_MAX_LENGTH}
                </span>
                <span className={css({ flex: 1 })} />
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                    className={css({
                        px: '3',
                        py: '1.5',
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '8px',
                        bg: 'surface',
                        color: 'text',
                        fontSize: '12px',
                        cursor: 'pointer',
                    })}
                >
                    やめる
                </button>
                <button
                    type="button"
                    disabled={busy || length > BIO_MAX_LENGTH}
                    onClick={() => void save()}
                    className={css({
                        px: '3',
                        py: '1.5',
                        border: '1px solid',
                        borderColor: 'primary',
                        borderRadius: '8px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        fontSize: '12px',
                        fontWeight: '700',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                    })}
                >
                    自己紹介を保存
                </button>
            </div>
            {error && <p className={css({ fontSize: '12px', color: 'errorText', mt: '1' })}>{error}</p>}
        </div>
    );
}
