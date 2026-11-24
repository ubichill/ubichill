import { useSocket } from '@ubichill/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ConsoleStatusBar } from '@/components/console/ConsoleStatusBar';
import { useConsoleEntries } from '@/components/console/useConsoleEntries';
import { useNotifications } from '@/components/notifications';
import { consoleCounts, latestProblem } from '@/lib/console/console';
import { css } from '@/styled-system/css';
import { HudIcon } from './HudIcon';
import { HudOverlay } from './HudOverlay';
import type { HudTab } from './hudView';
import { clearSettingsLink, readSettingsLink } from './settingsLink';
import { useLaunchpadHotkey } from './useLaunchpadHotkey';

/**
 * インスタンス内の常時表示 HUD。ボタンか Esc でランチパッドを開く。
 * エラー・警告がコンソールにあるときだけ、Unity のステータスバーのように画面の下の端に最後の 1 件と件数を出す
 * （押すとコンソールのタブを開く）。
 */
export function InstanceHUD() {
    const { id: instanceId } = useParams<{ id: string }>();
    const { isConnected } = useSocket();
    // 通知のメールなどから設定の欄を開いて来たら、入ったときにランチパッドをその欄で開く（1 回だけ）
    const [settingsLink, setSettingsLink] = useState(() => readSettingsLink(sessionStorage));
    const [open, setOpen] = useState(settingsLink !== null);
    const [initialTab, setInitialTab] = useState<HudTab | undefined>(settingsLink ? 'settings' : undefined);
    const close = useCallback(() => setOpen(false), []);
    const unread = useNotifications().feed.unreadCount > 0;
    const entries = useConsoleEntries();
    const counts = useMemo(() => consoleCounts(entries), [entries]);
    const problem = latestProblem(entries);
    useLaunchpadHotkey(open, setOpen);
    useEffect(() => clearSettingsLink(sessionStorage), []);
    // Esc やボタンで開いたときはランチパッドから
    useEffect(() => {
        if (open) return;
        setInitialTab(undefined);
        setSettingsLink(null);
    }, [open]);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={unread ? 'ランチパッドを開く（未読の通知あり）' : 'ランチパッドを開く'}
                aria-keyshortcuts="Escape"
                className={launcher}
                data-raised={!!problem}
            >
                <HudIcon name="rocket" size={24} />
                <span className={statusDot} data-connected={isConnected} />
                {unread && <span aria-hidden="true" className={unreadDot} />}
            </button>

            {!open && problem && (
                <div className={statusBar}>
                    <ConsoleStatusBar
                        entry={problem}
                        counts={counts}
                        onOpen={() => {
                            setInitialTab('console');
                            setOpen(true);
                        }}
                    />
                </div>
            )}

            {open && instanceId && (
                <HudOverlay
                    currentInstanceId={instanceId}
                    initialTab={initialTab}
                    settingsLink={settingsLink}
                    onClose={close}
                />
            )}
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
    // スマホは右下に置くので、下の帯が出ている間は帯の上に上げる
    '&[data-raised="true"]': { bottom: { base: '44px', md: 'auto' } },
});

/** 画面の下の端に付ける（浮かせない） */
const statusBar = css({ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9999 });

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
