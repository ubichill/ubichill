/**
 * `ubichill dev` の状態表示と診断。世代・部屋・接続の状態、「部屋を作り直す」、ビルドとワールドの失敗。
 *
 * 状態表示は右上の小さな札にする。ステージは画面全体（ポインタの座標は `clientY + scrollTop`）なので、
 * 上端に帯を敷くと `overlay: top-left` の HUD やワールドの上端が本番と違って隠れる。
 */
import { css } from '@/styled-system/css';
import type { DevEvent } from './devSession';

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
});
const dot = css({ width: '8px', height: '8px', borderRadius: '50%' });
// 繋がっているか（SSE）。色はトークンから
const dotState = { connected: css({ backgroundColor: 'success' }), disconnected: css({ backgroundColor: 'warning' }) };
const diagnostics = css({
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    zIndex: 10010,
    maxWidth: '520px',
    maxHeight: '40vh',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    p: '10px 12px',
    fontSize: '12px',
    fontFamily: 'monospace',
    color: 'errorText',
    backgroundColor: 'errorBg',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '10px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
});

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
}: {
    buildId: string | null;
    instanceId: string | null;
    connected: boolean;
    onReconfigure: () => void;
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
                onClick={onReconfigure}
                aria-label="部屋を作り直す"
                title="部屋を作り直す（状態を初期に戻す）"
            >
                <RefreshIcon />
            </button>
        </div>
    );
}

export function DevDiagnostics({ failures }: { failures: readonly DevEvent[] }) {
    if (failures.length === 0) return null;
    return (
        <div className={diagnostics} role="log">
            {failures.map((failure) =>
                failure.type === 'build-error' ? (
                    <div key={`build:${failure.mod}`}>
                        [{failure.mod}] {failure.message}
                    </div>
                ) : failure.type === 'world-error' ? (
                    <div key="world">[world] {failure.message}</div>
                ) : null,
            )}
        </div>
    );
}
