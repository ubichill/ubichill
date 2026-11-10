import { useSocket } from '@ubichill/react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { HudIcon } from '@/components/hud/HudIcon';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { signOut } from '@/lib/auth-client';
import { resetHome } from '@/lib/home/homeStore';
import { resetBlocks } from '@/lib/social/blocks';
import { css } from '@/styled-system/css';

/** ログアウト（設定の「アカウント」）。部屋から抜けてからサインアウトする。 */
export function LogoutSection() {
    const navigate = useNavigate();
    const confirm = useConfirm();
    const { leaveWorld } = useSocket();
    const [busy, setBusy] = useState(false);

    const logout = async () => {
        if (!(await confirm('ログアウトしますか？'))) return;
        setBusy(true);
        await leaveWorld();
        await signOut();
        resetHome();
        resetBlocks();
        navigate('/auth');
    };

    return (
        <div
            className={css({
                pt: '6',
                mt: '6',
                borderTopWidth: '1px',
                borderTopStyle: 'solid',
                borderTopColor: 'border',
            })}
        >
            <button type="button" className={button} disabled={busy} onClick={() => void logout()}>
                <HudIcon name="logout" size={18} />
                ログアウト
            </button>
        </div>
    );
}

const button = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '2',
    px: '4',
    py: '2.5',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'transparent',
    color: 'errorText',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease',
    _hover: { bg: 'errorBg' },
    _disabled: { opacity: 0.6, cursor: 'wait' },
});
