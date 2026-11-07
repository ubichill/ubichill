import { useSocket } from '@ubichill/react';
import { useState } from 'react';
import { useParams } from 'react-router';
import { useNotifications } from '@/components/notifications';
import { css } from '@/styled-system/css';
import { HudIcon } from './HudIcon';
import { HudOverlay } from './HudOverlay';
import { useLaunchpadHotkey } from './useLaunchpadHotkey';

/** インスタンス内の常時表示 HUD。ボタンか Esc でランチパッドを開く。 */
export function InstanceHUD() {
    const { id: instanceId } = useParams<{ id: string }>();
    const { isConnected } = useSocket();
    const [open, setOpen] = useState(false);
    const unread = useNotifications().feed.unreadCount > 0;
    useLaunchpadHotkey(open, setOpen);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={unread ? 'ランチパッドを開く（未読の通知あり）' : 'ランチパッドを開く'}
                aria-keyshortcuts="Escape"
                className={launcher}
            >
                <HudIcon name="rocket" size={24} />
                <span className={statusDot} data-connected={isConnected} />
                {unread && <span aria-hidden="true" className={unreadDot} />}
            </button>

            {open && instanceId && <HudOverlay currentInstanceId={instanceId} onClose={() => setOpen(false)} />}
        </>
    );
}

/** PC は右上・スマホは右下 */
const launcher = css({
    position: 'fixed',
    top: { base: 'auto', md: '20px' },
    bottom: { base: '20px', md: 'auto' },
    right: '20px',
    width: '52px',
    height: '52px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bg: 'hudBg',
    backdropFilter: 'blur(8px)',
    borderRadius: '14px',
    border: 'none',
    cursor: 'pointer',
    color: 'hudText',
    zIndex: 10000,
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    transition: 'background-color 0.15s ease',
    _hover: { bg: 'hudBgHover' },
});

const statusDot = css({
    position: 'absolute',
    top: '6px',
    right: '6px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    border: '1.5px solid',
    borderColor: 'hudBg',
    bg: 'hudStatusOff',
    '&[data-connected="true"]': { bg: 'hudStatusOn' },
});

const unreadDot = css({
    position: 'absolute',
    bottom: '6px',
    right: '6px',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    bg: 'warning',
});
