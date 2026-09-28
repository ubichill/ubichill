import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { fetchMyAccount } from '@/lib/account/me';
import { useSession } from '@/lib/session';
import { css } from '@/styled-system/css';

/** 公式アカウントが公開済みの開発用既定パスワードのままなら、ロビーで知らせる（Secret の設定を促す）。 */
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
            <span className={css({ flex: 1, minW: '200px' })}>
                公式アカウントが開発用の既定パスワードのままです。OFFICIAL_ACCOUNT_PASSWORD
                を設定して再起動してください。
            </span>
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
                詳細
            </button>
        </div>
    );
}
