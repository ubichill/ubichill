/**
 * 検証に失敗して実行しなかった mod を、理由つきで画面に出す。
 * 黙って消えると「壊れた」のか「止められた」のか利用者に分からないため。
 */
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
    py: '4px',
    borderRadius: '6px',
    border: 'none',
    bg: 'secondary',
    color: 'text',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    _hover: { opacity: 0.8 },
});

export function ModRejectionNotice({ mods, onRetry }: { mods: RejectedMod[]; onRetry: (mod: RejectedMod) => void }) {
    const [dismissed, setDismissed] = useState(false);
    const key = mods.map((m) => `${m.modId}:${m.message}`).join('|');
    // 内容が変わったら（新しく止められた mod が出たら）もう一度見せる
    // biome-ignore lint/correctness/useExhaustiveDependencies: key の変化だけを見る
    useEffect(() => setDismissed(false), [key]);

    if (mods.length === 0 || dismissed) return null;
    return (
        <div className={panel} role="alert">
            <div className={css({ display: 'flex', alignItems: 'center', gap: '8px' })}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="M12 3l9 16H3L12 3z"
                        className={css({ stroke: 'errorText' })}
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                    />
                    <path
                        d="M12 10v4"
                        className={css({ stroke: 'errorText' })}
                        strokeWidth="1.8"
                        strokeLinecap="round"
                    />
                    <circle cx="12" cy="16.5" r="0.9" className={css({ fill: 'errorText' })} />
                </svg>
                <span className={css({ flex: 1, fontSize: '13px', fontWeight: '700', color: 'text' })}>
                    実行しなかった mod があります
                </span>
                <button type="button" className={textButton} onClick={() => setDismissed(true)}>
                    閉じる
                </button>
            </div>
            {mods.map((mod) => (
                <div key={mod.modId} className={css({ display: 'flex', alignItems: 'center', gap: '8px' })}>
                    <div className={css({ flex: 1, minW: 0 })}>
                        <div className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>{mod.modId}</div>
                        <div className={css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.5' })}>
                            {mod.message}
                        </div>
                    </div>
                    {mod.retryable && (
                        <button type="button" className={textButton} onClick={() => onRetry(mod)}>
                            再試行
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
}
