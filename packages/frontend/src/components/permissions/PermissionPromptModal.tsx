/**
 * PermissionPromptModal — プラグインが危険な権限を初めて使うときに出す on-demand 承認モーダル。
 *
 * useUbiPermissions().pendingPrompt を購読し、許可/拒否を resolvePrompt で返す。
 * 決定はポリシーに記憶され、次回以降は無音になる（ゲート側でキャッシュ）。
 */
import { type CapabilityRisk, describeCapability, useUbiPermissions } from '@ubichill/react';
import { css } from '@/styled-system/css';

/** 危険度ティア → 表示ラベルと色トークン。 */
const RISK_META: Record<CapabilityRisk, { label: string; color: string; bg: string }> = {
    safe: { label: '安全', color: 'successText', bg: 'successBg' },
    sensitive: { label: '注意', color: 'text', bg: 'warning' },
    dangerous: { label: '危険', color: 'errorText', bg: 'errorBg' },
};

/** 危険度に応じた svg アイコン（絵文字は使わない）。 */
function RiskIcon({ risk }: { risk: CapabilityRisk }) {
    const stroke = risk === 'dangerous' ? 'error' : risk === 'sensitive' ? 'text' : 'successText';
    if (risk === 'safe') {
        return (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"
                    className={css({ stroke })}
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                />
                <path
                    d="M9 12l2 2 4-4"
                    className={css({ stroke })}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }
    return (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3l9 16H3L12 3z" className={css({ stroke })} strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M12 10v4" className={css({ stroke })} strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="0.9" className={css({ fill: stroke })} />
        </svg>
    );
}

export function PermissionPromptModal() {
    const permissions = useUbiPermissions();
    if (!permissions || !permissions.pendingPrompt) return null;

    const { pluginId, capability } = permissions.pendingPrompt;
    const info = describeCapability(capability);
    const risk = RISK_META[info.risk];

    return (
        <div
            className={css({
                position: 'fixed',
                inset: 0,
                zIndex: 10030,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            })}
            style={{
                backgroundColor: 'rgba(0,0,0,0.7)',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
            }}
        >
            <div
                className={css({
                    width: '100%',
                    maxWidth: '420px',
                    mx: '4',
                    bg: 'surfaceAccent',
                    borderRadius: '16px',
                    p: '24px',
                    boxShadow: 'modal',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                })}
            >
                <div className={css({ display: 'flex', alignItems: 'center', gap: '12px' })}>
                    <RiskIcon risk={info.risk} />
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
                        <span className={css({ fontSize: '11px', fontWeight: '600', color: 'textMuted' })}>
                            プラグイン「{pluginId}」がアクセスを要求
                        </span>
                        <span className={css({ fontSize: '17px', fontWeight: '700', color: 'text' })}>
                            {info.label}
                        </span>
                    </div>
                    <span
                        className={css({
                            ml: 'auto',
                            px: '10px',
                            py: '3px',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: '700',
                            bg: risk.bg,
                            color: risk.color,
                        })}
                    >
                        {risk.label}
                    </span>
                </div>

                <p className={css({ fontSize: '14px', color: 'text', lineHeight: '1.6' })}>{info.description}</p>

                <p className={css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.5' })}>
                    許可すると、このプラグインは以後この権限を使えます。あとから設定でいつでも取り消せます。
                </p>

                <div className={css({ display: 'flex', gap: '12px', mt: '4px' })}>
                    <button
                        type="button"
                        onClick={() => permissions.resolvePrompt('deny')}
                        className={css({
                            flex: 1,
                            py: '10px',
                            borderRadius: '8px',
                            border: 'none',
                            bg: 'secondary',
                            color: 'text',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s ease',
                            _hover: { opacity: 0.8 },
                        })}
                    >
                        拒否
                    </button>
                    <button
                        type="button"
                        onClick={() => permissions.resolvePrompt('allow')}
                        className={css({
                            flex: 1,
                            py: '10px',
                            borderRadius: '8px',
                            border: 'none',
                            bg: 'primary',
                            color: 'textOnPrimary',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s ease',
                            _hover: { bg: 'primaryHover' },
                        })}
                    >
                        許可
                    </button>
                </div>
            </div>
        </div>
    );
}
