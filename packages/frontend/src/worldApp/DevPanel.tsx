/**
 * `ubichill dev` の状態表示。世代・部屋・接続の状態、「部屋を作り直す」、コンソールの開閉。
 * ビルドとワールドの失敗は、コンソール（画面の下の端）に出す。
 *
 * 状態表示は右上の小さな札にする。ステージは画面全体（ポインタの座標は `clientY + scrollTop`）なので、
 * 上端に帯を敷くと `overlay: top-left` の HUD やワールドの上端が本番と違って隠れる。
 */

import { css } from '@/styled-system/css';

const bar = css({
    position: 'fixed',
    top: '8px',
    right: '8px',
    zIndex: 10010,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    pl: '10px',
    pr: '4px',
    py: '4px',
    borderRadius: '999px',
    fontSize: '11px',
    fontFamily: 'monospace',
    color: 'hudText',
    backgroundColor: 'hudBg',
    backdropFilter: 'blur(8px)',
});
const label = css({ color: 'hudTextMuted' });
const button = css({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '22px',
    height: '22px',
    border: 'none',
    borderRadius: '50%',
    color: 'hudTextAction',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    _hover: { backgroundColor: 'hudBgHover' },
    _pressed: { backgroundColor: 'hudBgHover' },
});
const dot = css({ width: '8px', height: '8px', borderRadius: '50%' });
// 繋がっているか（SSE）。色はトークンから
const dotState = { connected: css({ backgroundColor: 'success' }), disconnected: css({ backgroundColor: 'warning' }) };

function ConsoleIcon() {
    return (
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="m4 17 6-6-6-6M12 19h8" />
        </svg>
    );
}

function RefreshIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
        </svg>
    );
}

export function DevBar({
    buildId,
    instanceId,
    connected,
    onReconfigure,
    consoleOpen,
    onToggleConsole,
}: {
    buildId: string | null;
    instanceId: string | null;
    connected: boolean;
    onReconfigure: () => void;
    consoleOpen: boolean;
    onToggleConsole: () => void;
}) {
    return (
        <div
            className={bar}
            data-build-id={buildId ?? ''}
            data-instance-id={instanceId ?? ''}
            title={instanceId ? `部屋 ${instanceId}` : undefined}
        >
            <span className={`${dot} ${connected ? dotState.connected : dotState.disconnected}`} />
            <span>
                <span className={label}>dev </span>
                {buildId ?? 'ビルドを待っています'}
            </span>
            <button
                type="button"
                className={button}
                onClick={onToggleConsole}
                aria-pressed={consoleOpen}
                aria-label="コンソール"
            >
                <ConsoleIcon />
            </button>
            <button
                type="button"
                className={button}
                onClick={onReconfigure}
                aria-label="部屋を作り直す"
                title="部屋を作り直す（状態を初期に戻す）"
            >
                <RefreshIcon />
            </button>
        </div>
    );
}
