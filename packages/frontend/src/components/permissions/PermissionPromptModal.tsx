/**
 * PermissionPromptModal — 権限承認モーダル。2 種類のプロンプトを表示する。
 *  - mod: mod読み込み時、要求 capability 群をまとめて許可/拒否。
 *  - fetch : 外部通信の初回、ドメインを「今回だけ / 次回以降も許可 / 拒否」（Claude Code 風）。
 */
import { type CapabilityRisk, describeCapability, useUbiPermissions } from '@ubichill/react';
import { css } from '@/styled-system/css';

const RISK_META: Record<CapabilityRisk, { label: string; color: string; bg: string }> = {
    safe: { label: '安全', color: 'successText', bg: 'successBg' },
    sensitive: { label: '注意', color: 'text', bg: 'warning' },
    dangerous: { label: '危険', color: 'errorText', bg: 'errorBg' },
};

const RISK_ORDER: Record<CapabilityRisk, number> = { safe: 0, sensitive: 1, dangerous: 2 };

function ShieldIcon({ risk }: { risk: CapabilityRisk }) {
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

function RiskBadge({ risk }: { risk: CapabilityRisk }) {
    const meta = RISK_META[risk];
    return (
        <span
            className={css({
                px: '2',
                py: '0.5',
                borderRadius: '999px',
                fontSize: '10px',
                fontWeight: '700',
                flexShrink: 0,
                bg: meta.bg,
                color: meta.color,
            })}
        >
            {meta.label}
        </span>
    );
}

const overlay = css({
    position: 'fixed',
    inset: 0,
    zIndex: 10030,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
});

const panel = css({
    width: '100%',
    maxWidth: '440px',
    mx: '4',
    bg: 'surfaceAccent',
    borderRadius: '16px',
    p: '24px',
    boxShadow: 'modal',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
});

const primaryBtn = css({
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
});

const subtleBtn = css({
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
});

const overlayStyle = {
    backgroundColor: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
};

export function PermissionPromptModal() {
    const permissions = useUbiPermissions();
    if (!permissions || !permissions.pendingPrompt) return null;
    const prompt = permissions.pendingPrompt;
    const { resolvePrompt } = permissions;

    if (prompt.kind === 'fetch') {
        return (
            <div className={overlay} style={overlayStyle}>
                <div className={panel}>
                    <div className={css({ display: 'flex', alignItems: 'center', gap: '12px' })}>
                        <ShieldIcon risk="dangerous" />
                        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
                            <span className={css({ fontSize: '11px', fontWeight: '600', color: 'textMuted' })}>
                                「{prompt.modId}」が外部通信を要求
                            </span>
                            <span className={css({ fontSize: '16px', fontWeight: '700', color: 'text' })}>
                                {prompt.domain}
                            </span>
                        </div>
                    </div>
                    <p className={css({ fontSize: '13px', color: 'textMuted', lineHeight: '1.6' })}>
                        このmodが <strong>{prompt.domain}</strong> へ通信しようとしています。
                    </p>
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        <button type="button" onClick={() => resolvePrompt('always')} className={primaryBtn}>
                            次回以降も許可
                        </button>
                        <div className={css({ display: 'flex', gap: '2' })}>
                            <button type="button" onClick={() => resolvePrompt('once')} className={subtleBtn}>
                                今回だけ
                            </button>
                            <button type="button" onClick={() => resolvePrompt('deny')} className={subtleBtn}>
                                拒否
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // kind === 'mod'
    const infos = prompt.capabilities.map((c) => describeCapability(c.capability));
    const topRisk = infos.reduce<CapabilityRisk>(
        (acc, i) => (RISK_ORDER[i.risk] > RISK_ORDER[acc] ? i.risk : acc),
        'safe',
    );

    return (
        <div className={overlay} style={overlayStyle}>
            <div className={panel}>
                <div className={css({ display: 'flex', alignItems: 'center', gap: '12px' })}>
                    <ShieldIcon risk={topRisk} />
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
                        <span className={css({ fontSize: '11px', fontWeight: '600', color: 'textMuted' })}>
                            modが権限を要求
                        </span>
                        <span className={css({ fontSize: '17px', fontWeight: '700', color: 'text' })}>
                            {prompt.modId}
                        </span>
                    </div>
                </div>

                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    {infos.map((info) => (
                        <div
                            key={info.capability}
                            className={css({ display: 'flex', alignItems: 'center', gap: '3', py: '2' })}
                        >
                            <div className={css({ flex: 1, minW: 0 })}>
                                <div className={css({ display: 'flex', alignItems: 'center', gap: '2' })}>
                                    <span className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                                        {info.label}
                                    </span>
                                    <RiskBadge risk={info.risk} />
                                </div>
                                <div className={css({ fontSize: '11px', color: 'textMuted', mt: '0.5' })}>
                                    {info.description}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <p className={css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.5' })}>
                    許可すると、このmodは以後これらの権限を使えます。あとから設定でいつでも取り消せます。
                </p>

                <div className={css({ display: 'flex', gap: '12px' })}>
                    <button type="button" onClick={() => resolvePrompt('deny')} className={subtleBtn}>
                        拒否
                    </button>
                    <button type="button" onClick={() => resolvePrompt('allow')} className={primaryBtn}>
                        許可
                    </button>
                </div>
            </div>
        </div>
    );
}
