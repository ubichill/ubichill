import { useId } from 'react';
import { css } from '@/styled-system/css';
import { fieldHint, fieldInput, fieldLabel } from './profileStyles';

/** 文字数のカウンタ付きの入力（数え方は API と同じもの＝呼び出し側が渡す length）。 */
export function CountedTextField({
    label,
    value,
    length,
    max,
    problem,
    placeholder,
    multiline,
    disabled,
    onChange,
}: {
    label: string;
    value: string;
    length: number;
    max: number;
    problem: string | null;
    placeholder: string;
    multiline?: boolean;
    disabled: boolean;
    onChange: (value: string) => void;
}) {
    const over = length > max;
    const id = useId();
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
            <span
                className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2' })}
            >
                <label htmlFor={id} className={fieldLabel}>
                    {label}
                </label>
                <span className={fieldHint({ tone: over ? 'error' : 'muted' })}>
                    {length} / {max}
                </span>
            </span>
            {multiline ? (
                <textarea
                    id={id}
                    value={value}
                    rows={5}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className={fieldInput({ invalid: !!problem, multiline: true })}
                />
            ) : (
                <input
                    id={id}
                    value={value}
                    placeholder={placeholder}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className={fieldInput({ invalid: !!problem })}
                />
            )}
            {problem && <span className={fieldHint({ tone: 'error' })}>{problem}</span>}
        </div>
    );
}
