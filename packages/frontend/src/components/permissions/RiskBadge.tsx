import type { CapabilityRisk } from '@ubichill/react';
import { css } from '@/styled-system/css';

const RISK_META: Record<CapabilityRisk, { label: string; color: string; bg: string }> = {
    safe: { label: '安全', color: 'successText', bg: 'successBg' },
    sensitive: { label: '注意', color: 'text', bg: 'warning' },
    dangerous: { label: '危険', color: 'errorText', bg: 'errorBg' },
};

/** 権限の危険度のバッジ（承認の確認と権限の設定で同じ見た目にする）。 */
export function RiskBadge({ risk }: { risk: CapabilityRisk }) {
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
