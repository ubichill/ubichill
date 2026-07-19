/**
 * SettingsTab — ユーザー設定画面。現状はmod権限の管理。
 *
 * - シールドレベル（なし / 確認 / 厳格な確認 / 拒否）を選ぶと、危険度ティアの既定が決まる。
 *   安全な権限は常に許可でユーザーには見せない（判断が不要なため）。
 * - modごとに記憶済みの許可/拒否を危険度つきで確認し、取り消す。
 *
 * 権限状態は @ubichill/react の PermissionProvider（main.tsx でマウント）から取得する。
 */
import { type CapabilityRisk, describeCapability, type TierMode, useUbiPermissions } from '@ubichill/react';
import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

type ShieldLevelId = 'none' | 'standard' | 'strict' | 'block';

interface ShieldLevel {
    id: ShieldLevelId;
    label: string;
    desc: string;
    /** 危険度ティアごとの既定。安全(safe)は常に許可でユーザーには見せない。 */
    tiers: Record<CapabilityRisk, TierMode>;
}

const SHIELD_LEVELS: ShieldLevel[] = [
    {
        id: 'none',
        label: 'なし',
        desc: 'すべての権限を確認なしで許可します。信頼できる環境向け。',
        tiers: { safe: 'allow', sensitive: 'allow', dangerous: 'allow' },
    },
    {
        id: 'standard',
        label: '確認',
        desc: '外部通信など危険な権限だけ、使用時に確認します。',
        tiers: { safe: 'allow', sensitive: 'allow', dangerous: 'ask' },
    },
    {
        id: 'strict',
        label: '厳格な確認',
        desc: '注意が必要な権限も含めて、使用時に確認します。',
        tiers: { safe: 'allow', sensitive: 'ask', dangerous: 'ask' },
    },
    {
        id: 'block',
        label: '拒否',
        desc: '安全な権限以外はすべて拒否します。最大の自己防衛。',
        tiers: { safe: 'allow', sensitive: 'deny', dangerous: 'deny' },
    },
];

/** 現在の tierDefaults に一致するシールドレベルを求める（安全は無視、注意と危険で判定）。 */
function matchShieldLevel(tiers: Record<CapabilityRisk, TierMode>): ShieldLevelId | null {
    return (
        SHIELD_LEVELS.find((l) => l.tiers.sensitive === tiers.sensitive && l.tiers.dangerous === tiers.dangerous)?.id ??
        null
    );
}

const RISK_BADGE: Record<CapabilityRisk, { label: string; color: string; bg: string }> = {
    safe: { label: '安全', color: 'successText', bg: 'successBg' },
    sensitive: { label: '注意', color: 'text', bg: 'warning' },
    dangerous: { label: '危険', color: 'errorText', bg: 'errorBg' },
};

const DECISION_LABEL = { allow: '許可中', deny: '拒否中' } as const;

function RiskBadge({ risk }: { risk: CapabilityRisk }) {
    const meta = RISK_BADGE[risk];
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

export function SettingsTab() {
    const permissions = useUbiPermissions();

    if (!permissions) {
        return (
            <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
                <div className={cardStyle}>
                    <p className={css({ color: 'textMuted' })}>権限設定を利用できません。</p>
                </div>
            </div>
        );
    }

    const { policy, setTierDefaults, revokeGrant, revokeFetchGrant } = permissions;
    const currentLevel = matchShieldLevel(policy.tierDefaults);
    // capability grant または fetch ドメイン grant を持つmodの和集合。
    const modIds = [...new Set([...Object.keys(policy.grants), ...Object.keys(policy.fetchGrants)])].filter(
        (id) => Object.keys(policy.grants[id] ?? {}).length > 0 || Object.keys(policy.fetchGrants[id] ?? {}).length > 0,
    );

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            {/* ── シールドレベル ── */}
            <div className={cardStyle}>
                <h2 className={sectionHeading}>modの安全レベル</h2>
                <p className={css({ fontSize: '13px', color: 'textMuted', mb: '5', lineHeight: '1.6' })}>
                    modが権限を使うときの確認の厳しさです。厳しくするほど、modが権限を使う前に確認します。
                </p>
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                    {SHIELD_LEVELS.map((level) => {
                        const active = currentLevel === level.id;
                        return (
                            <button
                                key={level.id}
                                type="button"
                                onClick={() => setTierDefaults(level.tiers)}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3',
                                    textAlign: 'left',
                                    p: '3',
                                    borderRadius: '12px',
                                    border: '2px solid',
                                    borderColor: active ? 'primary' : 'transparent',
                                    bg: active ? 'primarySubtle' : 'surface',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    _hover: { bg: active ? 'primarySubtle' : 'surfaceHover' },
                                })}
                            >
                                <span
                                    className={css({
                                        w: '18px',
                                        h: '18px',
                                        borderRadius: '999px',
                                        border: '2px solid',
                                        borderColor: active ? 'primary' : 'borderStrong',
                                        bg: active ? 'primary' : 'transparent',
                                        flexShrink: 0,
                                    })}
                                />
                                <span className={css({ flex: 1, minW: 0 })}>
                                    <span
                                        className={css({
                                            display: 'block',
                                            fontSize: '14px',
                                            fontWeight: '700',
                                            color: 'text',
                                        })}
                                    >
                                        {level.label}
                                    </span>
                                    <span
                                        className={css({
                                            display: 'block',
                                            fontSize: '12px',
                                            color: 'textMuted',
                                            mt: '1',
                                        })}
                                    >
                                        {level.desc}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── modごとの許可 ── */}
            <div className={cardStyle}>
                <h2 className={sectionHeading}>modごとの許可</h2>
                {modIds.length === 0 ? (
                    <div
                        className={css({
                            p: '6',
                            bg: 'surface',
                            borderRadius: '12px',
                            textAlign: 'center',
                            color: 'textMuted',
                            fontSize: '14px',
                        })}
                    >
                        まだ許可・拒否を記憶したmodはありません。
                    </div>
                ) : (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                        {modIds.map((modId) => (
                            <div key={modId} className={css({ p: '3', bg: 'surface', borderRadius: '12px' })}>
                                <div
                                    className={css({
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        mb: '3',
                                    })}
                                >
                                    <span className={css({ fontSize: '15px', fontWeight: '700', color: 'text' })}>
                                        {modId}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            revokeGrant(modId);
                                            revokeFetchGrant(modId);
                                        }}
                                        className={css({
                                            px: '3',
                                            py: '1',
                                            borderRadius: '8px',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                            fontWeight: '600',
                                            bg: 'transparent',
                                            color: 'errorText',
                                            _hover: { bg: 'errorBg' },
                                        })}
                                    >
                                        すべて取り消す
                                    </button>
                                </div>
                                <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                                    {Object.entries(policy.grants[modId] ?? {}).map(([capability, decision]) => {
                                        const info = describeCapability(capability);
                                        return (
                                            <div
                                                key={capability}
                                                className={css({
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '3',
                                                    py: '2',
                                                })}
                                            >
                                                <div className={css({ flex: 1, minW: 0 })}>
                                                    <div
                                                        className={css({
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '2',
                                                        })}
                                                    >
                                                        <span
                                                            className={css({
                                                                fontSize: '13px',
                                                                fontWeight: '600',
                                                                color: 'text',
                                                            })}
                                                        >
                                                            {info.label}
                                                        </span>
                                                        <RiskBadge risk={info.risk} />
                                                    </div>
                                                    <div
                                                        className={css({
                                                            fontSize: '11px',
                                                            color: 'textMuted',
                                                            mt: '0.5',
                                                        })}
                                                    >
                                                        {info.description}
                                                    </div>
                                                </div>
                                                <span
                                                    className={css({
                                                        fontSize: '11px',
                                                        fontWeight: '700',
                                                        color: decision === 'allow' ? 'successText' : 'errorText',
                                                        flexShrink: 0,
                                                    })}
                                                >
                                                    {DECISION_LABEL[decision]}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => revokeGrant(modId, capability)}
                                                    className={css({
                                                        px: '2',
                                                        py: '1',
                                                        borderRadius: '6px',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        fontSize: '11px',
                                                        fontWeight: '600',
                                                        bg: 'secondary',
                                                        color: 'text',
                                                        flexShrink: 0,
                                                        _hover: { opacity: 0.8 },
                                                    })}
                                                >
                                                    取り消す
                                                </button>
                                            </div>
                                        );
                                    })}
                                    {/* fetch 許可ドメイン */}
                                    {Object.entries(policy.fetchGrants[modId] ?? {}).map(([domain, decision]) => (
                                        <div
                                            key={`fetch:${domain}`}
                                            className={css({
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '3',
                                                py: '2',
                                            })}
                                        >
                                            <div className={css({ flex: 1, minW: 0 })}>
                                                <div
                                                    className={css({ display: 'flex', alignItems: 'center', gap: '2' })}
                                                >
                                                    <span
                                                        className={css({
                                                            fontSize: '13px',
                                                            fontWeight: '600',
                                                            color: 'text',
                                                        })}
                                                    >
                                                        {domain}
                                                    </span>
                                                    <RiskBadge risk="dangerous" />
                                                </div>
                                                <div
                                                    className={css({ fontSize: '11px', color: 'textMuted', mt: '0.5' })}
                                                >
                                                    外部への通信
                                                </div>
                                            </div>
                                            <span
                                                className={css({
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    color: decision === 'allow' ? 'successText' : 'errorText',
                                                    flexShrink: 0,
                                                })}
                                            >
                                                {DECISION_LABEL[decision]}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => revokeFetchGrant(modId, domain)}
                                                className={css({
                                                    px: '2',
                                                    py: '1',
                                                    borderRadius: '6px',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    fontSize: '11px',
                                                    fontWeight: '600',
                                                    bg: 'secondary',
                                                    color: 'text',
                                                    flexShrink: 0,
                                                    _hover: { opacity: 0.8 },
                                                })}
                                            >
                                                取り消す
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
