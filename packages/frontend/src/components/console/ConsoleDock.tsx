import { useMemo, useState } from 'react';
import { consoleCounts, latestProblem } from '@/lib/console/console';
import { appConsole } from '@/lib/console/consoleStore';
import { css } from '@/styled-system/css';
import { ConsolePanel } from './ConsolePanel';
import { ConsoleStatusBar } from './ConsoleStatusBar';
import { useConsoleEntries } from './useConsoleEntries';

/**
 * 画面の下の端に付けるコンソール（ランチパッドの無い world.html 用）。浮かせない。
 * エラー・警告があるときだけステータスバー（最後の 1 件と件数）を出し、押すとその上にコンソールを開く。
 * `open`・`onOpenChange` を渡すと、開閉を外から決める（dev サーバーの札のボタンから、問題が無くても開けるように）。
 */
export function ConsoleDock({
    open: controlledOpen,
    onOpenChange,
}: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}) {
    const entries = useConsoleEntries();
    const [ownOpen, setOwnOpen] = useState(false);
    const open = controlledOpen ?? ownOpen;
    const setOpen = onOpenChange ?? setOwnOpen;
    const counts = useMemo(() => consoleCounts(entries), [entries]);
    const latest = latestProblem(entries);
    if (!open && !latest) return null;
    return (
        <div className={dock}>
            {open && (
                <div className={panelArea}>
                    <ConsolePanel entries={entries} onClear={appConsole.clear} />
                </div>
            )}
            {latest ? (
                <ConsoleStatusBar entry={latest} counts={counts} expanded={open} onOpen={() => setOpen(!open)} />
            ) : (
                <button type="button" aria-expanded={open} className={closeBar} onClick={() => setOpen(false)}>
                    コンソールを閉じる
                </button>
            )}
        </div>
    );
}

const dock = css({
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
});

const panelArea = css({
    h: '40dvh',
    minH: '200px',
    display: 'flex',
    flexDirection: 'column',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'border',
});

const closeBar = css({
    h: '24px',
    px: '10px',
    border: 'none',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'border',
    bg: 'surfaceAccent',
    color: 'textMuted',
    fontSize: '11px',
    textAlign: 'left',
    cursor: 'pointer',
    _hover: { bg: 'surfaceHover', color: 'text' },
});
