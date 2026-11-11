import { css } from '@/styled-system/css';
import type { ConsoleLevel } from '../lib/editorConsole';
import { StatusIcon } from './statusIcons';

export type BottomDockTab = 'assets' | 'console';

interface BottomDockTabsProps {
    active: BottomDockTab;
    onChange: (tab: BottomDockTab) => void;
    counts: Record<ConsoleLevel, number>;
    /** 右端に置く、今のタブの操作 */
    actions?: React.ReactNode;
}

/** 下のドックの切り替え（アセット / コンソール）。コンソールには溜まったエラー・警告の数を出す。 */
export function BottomDockTabs({ active, onChange, counts, actions }: BottomDockTabsProps) {
    return (
        <div
            className={css({
                display: 'flex',
                alignItems: 'stretch',
                gap: '2px',
                px: '8px',
                borderTop: '1px solid',
                borderBottom: '1px solid',
                borderColor: 'border',
                bg: 'surfaceAccent',
                flexShrink: 0,
            })}
        >
            <div role="tablist" className={css({ display: 'flex', gap: '2px' })}>
                <Tab id="assets" active={active} onChange={onChange}>
                    アセット
                </Tab>
                <Tab id="console" active={active} onChange={onChange}>
                    コンソール
                    {counts.error > 0 && <Count level="error" value={counts.error} />}
                    {counts.warning > 0 && <Count level="warning" value={counts.warning} />}
                </Tab>
            </div>
            {actions && (
                <div className={css({ ml: 'auto', display: 'flex', alignItems: 'center', gap: '6px' })}>{actions}</div>
            )}
        </div>
    );
}

function Tab({
    id,
    active,
    onChange,
    children,
}: {
    id: BottomDockTab;
    active: BottomDockTab;
    onChange: (tab: BottomDockTab) => void;
    children: React.ReactNode;
}) {
    const selected = id === active;
    return (
        <button
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(id)}
            className={css({
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 8px',
                fontSize: '12px',
                fontWeight: '600',
                bg: 'transparent',
                border: 'none',
                borderBottom: '2px solid',
                borderColor: selected ? 'primary' : 'transparent',
                color: selected ? 'text' : 'textMuted',
                cursor: 'pointer',
                marginBottom: '-1px',
                _hover: { color: 'text' },
            })}
        >
            {children}
        </button>
    );
}

function Count({ level, value }: { level: ConsoleLevel; value: number }) {
    return (
        <span className={css({ display: 'inline-flex', alignItems: 'center', gap: '2px', fontWeight: '500' })}>
            <StatusIcon level={level} />
            {value > 99 ? '99+' : value}
        </span>
    );
}
