import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { css } from '@/styled-system/css';
import { inputStyle } from './shared';

/**
 * 数値入力の共通基盤。
 *  - **NaN を 0 に丸めない** (途中 "-" / "." / 空 で値が 0 にされない)
 *  - 入力中はローカルテキスト state を保持し、有効な数値のときだけ親へ commit
 *  - 親 (= 外部) からの value 変化はテキストへ同期 (例: ステージで drag したとき)
 *  - blur 時は最後に commit した値へテキストを揃える (空のまま離れない)
 */
export function NumberInput({
    value,
    onChange,
    min,
    max,
    step,
    className,
}: {
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
}) {
    const [text, setText] = useState(String(value));
    const lastEmittedRef = useRef(value);
    useEffect(() => {
        if (value !== lastEmittedRef.current) {
            setText(String(value));
            lastEmittedRef.current = value;
        }
    }, [value]);
    const commit = (raw: string) => {
        const n = Number.parseFloat(raw);
        if (!Number.isFinite(n)) return;
        let v = n;
        if (min !== undefined) v = Math.max(v, min);
        if (max !== undefined) v = Math.min(v, max);
        if (v !== lastEmittedRef.current) {
            lastEmittedRef.current = v;
            onChange(v);
        }
    };
    return (
        <input
            type="number"
            value={text}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
                setText(e.target.value);
                commit(e.target.value);
            }}
            onBlur={() => {
                if (text === '' || !Number.isFinite(Number.parseFloat(text))) {
                    setText(String(lastEmittedRef.current));
                }
            }}
            className={className}
        />
    );
}

export function NumField({
    label,
    value,
    max,
    onChange,
}: {
    label: string;
    value: number;
    max?: number;
    onChange: (v: number) => void;
}) {
    return (
        // biome-ignore lint/a11y/noLabelWithoutControl: NumberInput が input を内包している
        <label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
            <span className={css({ fontSize: '11px', color: 'textMuted' })}>{label}</span>
            <NumberInput value={value} max={max} onChange={onChange} className={inputStyle} />
        </label>
    );
}

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            <div className={css({ fontSize: '12px', fontWeight: '600', color: 'text' })}>{label}</div>
            {children}
        </div>
    );
}

export function MiniTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={css({
                padding: '3px 8px',
                bg: active ? 'primary' : 'background',
                color: active ? 'textOnPrimary' : 'textMuted',
                border: '1px solid',
                borderColor: active ? 'primary' : 'border',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
                _hover: { opacity: 0.9 },
            })}
        >
            {label}
        </button>
    );
}

export function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            aria-hidden="true"
        >
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}
