import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchMyAccount } from '@/lib/account/me';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';

/** 初期パスワードのまま（公式アカウントの初回ログインなど）なら、変更するまでロビーで知らせる。 */
export function PasswordChangeNotice() {
    const navigate = useNavigate();
    const { data: session } = useSession();
    const [required, setRequired] = useState(false);
    const userId = session?.user.id;

    useEffect(() => {
        if (!userId) return;
        const ignore = { current: false };
        fetchMyAccount()
            .then((account) => {
                if (!ignore.current) setRequired(account.passwordChangeRequired);
            })
            .catch(() => undefined);
        return () => {
            ignore.current = true;
        };
    }, [userId]);

    if (!userId || !required) return null;
    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'center',
                gap: '3',
                flexWrap: 'wrap',
                mb: '3',
                px: '4',
                py: '3',
                bg: 'errorBg',
                color: 'errorText',
                borderRadius: '12px',
                fontSize: '13px',
            })}
        >
            <span className={css({ flex: 1, minW: '200px' })}>初期パスワードのままです。すぐに変更してください。</span>
            <button
                type="button"
                onClick={() => navigate(`/user/${userId}`)}
                className={css({
                    px: '3',
                    py: '6px',
                    bg: 'surface',
                    color: 'text',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    _hover: { bg: 'surfaceHover' },
                })}
            >
                パスワードを変更する
            </button>
        </div>
    );
}
