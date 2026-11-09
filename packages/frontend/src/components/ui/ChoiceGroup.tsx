import type { ReactNode } from 'react';
import { css, cva } from '@/styled-system/css';

const option = cva({
    base: {
        display: 'flex',
        alignItems: 'center',
        gap: '2',
        px: '3',
        py: '2',
        border: '1px solid',
        borderRadius: '10px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
    },
    variants: {
        selected: {
            true: { bg: 'primary', color: 'textOnPrimary', borderColor: 'primary' },
            false: { bg: 'surface', color: 'text', borderColor: 'border', _hover: { bg: 'surfaceHover' } },
        },
    },
});

export interface Choice<T extends string> {
    value: T;
    label: string;
    icon?: ReactNode;
}

/** いくつかから 1 つ選ぶ（公開範囲など）。下に選んだものの説明を出す。 */
export function ChoiceGroup<T extends string>({
    label,
    choices,
    value,
    description,
    disabled,
    onChange,
}: {
    /** 読み上げの名前 */
    label: string;
    choices: ReadonlyArray<Choice<T>>;
    value: T;
    description?: string | null;
    disabled?: boolean;
    onChange: (next: T) => void;
}) {
    return (
        <div>
            <div role="radiogroup" aria-label={label} className={css({ display: 'flex', gap: '2', flexWrap: 'wrap' })}>
                {choices.map((c) => (
                    <button
                        key={c.value}
                        type="button"
                        role="radio"
                        aria-checked={c.value === value}
                        disabled={disabled}
                        onClick={() => c.value !== value && onChange(c.value)}
                        className={option({ selected: c.value === value })}
                    >
                        {c.icon}
                        {c.label}
                    </button>
                ))}
            </div>
            {description && (
                <p className={css({ mt: '2', fontSize: '12px', color: 'textMuted', lineHeight: '1.6' })}>
                    {description}
                </p>
            )}
        </div>
    );
}
