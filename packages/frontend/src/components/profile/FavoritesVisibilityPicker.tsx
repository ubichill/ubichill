import type { FavoritesVisibility } from '@ubichill/shared';
import { ChoiceGroup } from '@/components/ui/ChoiceGroup';
import { FAVORITES_VISIBILITY_OPTIONS, favoritesVisibilityNote } from '@/lib/account/favoritesVisibility';

function VisibilityIcon({ value }: { value: FavoritesVisibility }) {
    const common = {
        width: 16,
        height: 16,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        'aria-hidden': true,
    };
    if (value === 'private') {
        return (
            <svg {...common}>
                <rect x="5" y="11" width="14" height="9" rx="2" />
                <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
        );
    }
    if (value === 'friends') {
        return (
            <svg {...common}>
                <circle cx="9" cy="8" r="3" />
                <path d="M3 20a6 6 0 0 1 12 0" />
                <path d="M16 5.5a3 3 0 0 1 0 5M18 20a6 6 0 0 0-2.5-4.9" />
            </svg>
        );
    }
    return (
        <svg {...common}>
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
        </svg>
    );
}

interface FavoritesVisibilityPickerProps {
    value: FavoritesVisibility;
    disabled?: boolean;
    onChange: (next: FavoritesVisibility) => void;
}

/** お気に入りの公開範囲（Private / Friends / Public）の選択。 */
export function FavoritesVisibilityPicker({ value, disabled, onChange }: FavoritesVisibilityPickerProps) {
    const current = FAVORITES_VISIBILITY_OPTIONS.find((o) => o.value === value);
    const note = favoritesVisibilityNote(value);
    return (
        <ChoiceGroup
            label="お気に入りの公開範囲"
            choices={FAVORITES_VISIBILITY_OPTIONS.map((o) => ({
                value: o.value,
                label: o.label,
                icon: <VisibilityIcon value={o.value} />,
            }))}
            value={value}
            description={[current?.description, note].filter(Boolean).join(' ')}
            disabled={disabled}
            onChange={onChange}
        />
    );
}
