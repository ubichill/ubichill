import { useState } from 'react';
import { revokeOtherSessions } from '@/lib/account/me';
import { css, cva } from '@/styled-system/css';

const button = cva({
    base: {
        px: '3',
        py: '1.5',
        border: '1px solid',
        borderColor: 'errorText',
        borderRadius: '8px',
        bg: 'surface',
        color: 'errorText',
        fontSize: '12px',
        fontWeight: '700',
        cursor: 'pointer',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
});

/**
 * 漏えい・心当たりのない環境を取り消した直後の案内。公開環境を取り消しても攻撃者のログインは残り、
 * すぐに新しい環境を登録し直せるので、ほかの端末のログアウトとパスワードの変更へ案内する。
 */
export function CompromiseGuide({ onDismiss }: { onDismiss: () => void }) {
    const [state, setState] = useState<{ busy: boolean; result: string; error: string }>({
        busy: false,
        result: '',
        error: '',
    });

    const logoutOthers = async () => {
        setState({ busy: true, result: '', error: '' });
        try {
            const count = await revokeOtherSessions();
            setState({ busy: false, result: `ほかの端末のログイン ${count} 件を無効にしました。`, error: '' });
        } catch (e) {
            setState({ busy: false, result: '', error: e instanceof Error ? e.message : 'ログアウトできませんでした' });
        }
    };

    return (
        <div
            role="alert"
            className={css({
                fontSize: '13px',
                px: '3',
                py: '3',
                mb: '3',
                borderRadius: '8px',
                bg: 'errorBg',
                color: 'errorText',
                lineHeight: '1.6',
            })}
        >
            <p className={css({ fontWeight: '700' })}>アカウントを乗っ取られている可能性があります</p>
            <p>
                公開環境を取り消しても、攻撃者のログインは残り、新しい環境をすぐに登録し直せます。次の 2
                つを続けて行ってください。
            </p>
            <ol className={css({ pl: '5', my: '2', listStyleType: 'decimal' })}>
                <li>ほかの端末をすべてログアウトする（このブラウザ以外のログインを無効にします）</li>
                <li>上の「パスワード」から、パスワードを変更する</li>
            </ol>
            <div className={css({ display: 'flex', gap: '2', alignItems: 'center', flexWrap: 'wrap' })}>
                <button type="button" className={button()} disabled={state.busy} onClick={() => void logoutOthers()}>
                    ほかの端末をすべてログアウト
                </button>
                <button
                    type="button"
                    className={css({
                        fontSize: '12px',
                        color: 'textMuted',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                    })}
                    onClick={onDismiss}
                >
                    閉じる
                </button>
            </div>
            {state.result && <p className={css({ mt: '2', color: 'successText' })}>{state.result}</p>}
            {state.error && <p className={css({ mt: '2' })}>{state.error}</p>}
        </div>
    );
}
