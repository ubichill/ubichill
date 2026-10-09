/** 読み込めなかった mod の案内。折りたたんでも再確認への入口を残す。 */
import { useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import type { RejectedMod } from './modRejection';

const panel = css({
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 10020,
    width: 'calc(100% - 24px)',
    maxWidth: '460px',
    maxHeight: 'calc(100dvh - 24px)',
    overflowY: 'auto',
    bg: 'surfaceAccent',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '12px',
    boxShadow: 'modal',
    p: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
});
const textButton = css({
    flexShrink: 0,
    px: '10px',
    py: '6px',
    minHeight: '36px',
    borderRadius: '6px',
    border: 'none',
    bg: 'secondary',
    color: 'text',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    _hover: { opacity: 0.8 },
    _disabled: { opacity: 0.6, cursor: 'wait' },
    _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '2px' },
});

export function ModRejectionNotice({
    mods,
    retryingMods,
    onRetry,
}: {
    mods: RejectedMod[];
    retryingMods: ReadonlySet<string>;
    onRetry: (mod: RejectedMod) => void;
}) {
    const [expanded, setExpanded] = useState(true);
    const key = mods.map((mod) => mod.modId).join('|');
    // 新しい失敗が加わったときに詳細を開く。同じ mod の再確認中は開閉状態を保つ。
    // biome-ignore lint/correctness/useExhaustiveDependencies: key は失敗した mod の集合
    useEffect(() => setExpanded(true), [key]);
    if (mods.length === 0) return null;
    return (
        <section className={panel} aria-label="mod の読み込み状況">
            <div className={css({ display: 'flex', alignItems: 'center', gap: '8px' })}>
                <span
                    role="status"
                    className={css({ flex: 1, minW: 0, fontSize: '13px', fontWeight: '700', color: 'text' })}
                >
                    {retryingMods.size > 0 ? 'mod を再確認しています…' : `読み込めなかった mod：${mods.length}件`}
                </span>
                <button
                    type="button"
                    className={textButton}
                    aria-expanded={expanded}
                    aria-controls="mod-loading-issues"
                    onClick={() => setExpanded((value) => !value)}
                >
                    {expanded ? '折りたたむ' : '詳細を開く'}
                </button>
            </div>
            {expanded && (
                <div id="mod-loading-issues" className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                    {mods.map((mod) => {
                        const checking = retryingMods.has(mod.modId);
                        return (
                            <div
                                key={mod.modId}
                                className={css({ display: 'flex', alignItems: 'center', gap: '8px' })}
                                aria-busy={checking}
                            >
                                <div className={css({ flex: 1, minW: 0, overflowWrap: 'anywhere' })}>
                                    <div className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                                        {mod.modId}
                                    </div>
                                    <div className={css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.5' })}>
                                        {checking ? '利用できるか確認中…' : mod.message}
                                    </div>
                                </div>
                                {mod.retryable && (
                                    <button
                                        type="button"
                                        className={textButton}
                                        disabled={checking}
                                        aria-label={`${mod.modId} を再試行`}
                                        onClick={() => onRetry(mod)}
                                    >
                                        {checking ? '確認中…' : '再試行'}
                                    </button>
                                )}
                            </div>
                        );
                    })}
                    <p className={css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.5' })}>
                        {mods.some((mod) => !mod.retryable)
                            ? '署名や内容の問題は、ワールドの作者にこの理由を伝えてください。'
                            : '通信が回復したら、再試行してください。'}
                    </p>
                </div>
            )}
        </section>
    );
}
