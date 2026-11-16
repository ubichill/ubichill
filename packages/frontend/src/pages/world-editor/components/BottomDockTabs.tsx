import { ConsoleCounts } from '@/components/console/ConsoleCounts';
import type { ConsoleLevel } from '@/lib/console/console';
import { css } from '@/styled-system/css';

export type BottomDockTab = 'assets' | 'console';

interface BottomDockTabsProps {
    active: BottomDockTab;
    onChange: (tab: BottomDockTab) => void;
    counts: Record<ConsoleLevel, number>;
}

/**
 * 下のドックの切り替え（アセット / コンソール）。コンソールを閉じている間は、溜まったエラー・警告の数をタブに出す
 * （開いている間はコンソールのツールバーに件数がある）。
 */
export function BottomDockTabs({ active, onChange, counts }: BottomDockTabsProps) {
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
                    {active !== 'console' && <ConsoleCounts counts={counts} className={css({ fontWeight: '500' })} />}
                </Tab>
            </div>
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
