import { css } from '@/styled-system/css';
import type { ControlPanelTab } from '../hooks/useEditorModals';

const TABS: { id: ControlPanelTab; label: string }[] = [
    { id: 'info', label: 'ワールド情報' },
    { id: 'publish', label: '公開設定' },
    { id: 'mods', label: 'mod管理' },
    { id: 'yaml', label: 'YAML' },
];

interface ControlPanelTabsProps {
    active: ControlPanelTab;
    onChange: (tab: ControlPanelTab) => void;
}

/** コントロールパネル内のタブ切り替え。 */
export function ControlPanelTabs({ active, onChange }: ControlPanelTabsProps) {
    return (
        <div
            className={css({
                display: 'flex',
                gap: '4px',
                borderBottom: '1px solid',
                borderColor: 'border',
                mb: '4',
            })}
        >
            {TABS.map((tab) => {
                const isActive = active === tab.id;
                return (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => onChange(tab.id)}
                        className={css({
                            padding: '8px 14px',
                            fontSize: '13px',
                            fontWeight: '600',
                            color: isActive ? 'primary' : 'textMuted',
                            bg: 'transparent',
                            border: 'none',
                            borderBottom: '2px solid',
                            borderColor: isActive ? 'primary' : 'transparent',
                            cursor: 'pointer',
                            marginBottom: '-1px',
                            _hover: { color: 'text' },
                        })}
                    >
                        {tab.label}
                    </button>
                );
            })}
        </div>
    );
}
