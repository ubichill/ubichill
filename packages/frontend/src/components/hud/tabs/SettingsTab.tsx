/**
 * SettingsTab — ユーザー設定画面。現状はプラグイン権限の管理。
 *
 * - 危険度ティアごとの既定モード（許可 / 都度確認 / 拒否）を切り替える。
 * - プラグインごとに記憶済みの許可/拒否を確認し、取り消す。
 *
 * 権限状態は @ubichill/react の PermissionProvider（main.tsx でマウント）から取得する。
 */
import { type CapabilityRisk, describeCapability, type TierMode, useUbiPermissions } from '@ubichill/react';
import { css } from '@/styled-system/css';
import { cardStyle, sectionHeading, tabPanel } from './shared';

const TIER_ORDER: CapabilityRisk[] = ['safe', 'sensitive', 'dangerous'];

const TIER_LABEL: Record<CapabilityRisk, { title: string; desc: string; color: string }> = {
    safe: { title: '安全な権限', desc: 'シーン読み取り・UI 表示など。外部への影響なし。', color: 'successText' },
    sensitive: { title: '注意が必要な権限', desc: 'シーン変更・メディア制御など。ワールド内に影響。', color: 'text' },
    dangerous: { title: '危険な権限', desc: '外部通信・ホスト送信など。情報流出のリスク。', color: 'errorText' },
};

const MODE_OPTIONS: { mode: TierMode; label: string }[] = [
    { mode: 'allow', label: '許可' },
    { mode: 'ask', label: '都度確認' },
    { mode: 'deny', label: '拒否' },
];

const DECISION_LABEL = { allow: '許可中', deny: '拒否中' } as const;

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

    const { policy, setTierDefault, revokeGrant } = permissions;
    const pluginIds = Object.keys(policy.grants).filter((id) => Object.keys(policy.grants[id]).length > 0);

    return (
        <div className={tabPanel} onClick={(e) => e.stopPropagation()}>
            {/* ── ティア既定モード ── */}
            <div className={cardStyle}>
                <h2 className={sectionHeading}>プラグイン権限の既定</h2>
                <p className={css({ fontSize: '13px', color: 'textMuted', mb: '5', lineHeight: '1.6' })}>
                    プラグインが権限を要求したときの既定の扱いです。「都度確認」にすると、そのプラグインが初めて使うたびに確認します。
                </p>
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                    {TIER_ORDER.map((risk) => {
                        const meta = TIER_LABEL[risk];
                        const current = policy.tierDefaults[risk];
                        return (
                            <div
                                key={risk}
                                className={css({
                                    display: 'flex',
                                    flexDirection: { base: 'column', md: 'row' },
                                    alignItems: { base: 'stretch', md: 'center' },
                                    gap: '3',
                                    p: '3',
                                    bg: 'surface',
                                    borderRadius: '12px',
                                })}
                            >
                                <div className={css({ flex: 1, minW: 0 })}>
                                    <div className={css({ fontSize: '14px', fontWeight: '700', color: meta.color })}>
                                        {meta.title}
                                    </div>
                                    <div className={css({ fontSize: '12px', color: 'textMuted', mt: '1' })}>
                                        {meta.desc}
                                    </div>
                                </div>
                                <div
                                    className={css({
                                        display: 'flex',
                                        gap: '1',
                                        bg: 'secondary',
                                        borderRadius: '10px',
                                        p: '1',
                                        flexShrink: 0,
                                    })}
                                >
                                    {MODE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.mode}
                                            type="button"
                                            onClick={() => setTierDefault(risk, opt.mode)}
                                            className={css({
                                                px: '3',
                                                py: '2',
                                                borderRadius: '8px',
                                                border: 'none',
                                                cursor: 'pointer',
                                                fontSize: '12px',
                                                fontWeight: '700',
                                                transition: 'all 0.15s ease',
                                                bg: current === opt.mode ? 'primary' : 'transparent',
                                                color: current === opt.mode ? 'textOnPrimary' : 'textMuted',
                                                _hover: { color: current === opt.mode ? 'textOnPrimary' : 'text' },
                                            })}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── プラグインごとの許可 ── */}
            <div className={cardStyle}>
                <h2 className={sectionHeading}>プラグインごとの許可</h2>
                {pluginIds.length === 0 ? (
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
                        まだ許可・拒否を記憶したプラグインはありません。
                    </div>
                ) : (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                        {pluginIds.map((pluginId) => (
                            <div key={pluginId} className={css({ p: '3', bg: 'surface', borderRadius: '12px' })}>
                                <div
                                    className={css({
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        mb: '3',
                                    })}
                                >
                                    <span className={css({ fontSize: '15px', fontWeight: '700', color: 'text' })}>
                                        {pluginId}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => revokeGrant(pluginId)}
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
                                    {Object.entries(policy.grants[pluginId]).map(([capability, decision]) => {
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
                                                            fontSize: '13px',
                                                            fontWeight: '600',
                                                            color: 'text',
                                                        })}
                                                    >
                                                        {info.label}
                                                    </div>
                                                    <div className={css({ fontSize: '11px', color: 'textMuted' })}>
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
                                                    onClick={() => revokeGrant(pluginId, capability)}
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
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
