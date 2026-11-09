import { css, cva } from '@/styled-system/css';

const toggle = cva({
    base: {
        position: 'relative',
        flexShrink: 0,
        w: '40px',
        h: '22px',
        borderRadius: '999px',
        border: 'none',
        cursor: 'pointer',
        transition: 'background 0.15s',
        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
        _after: {
            content: '""',
            position: 'absolute',
            top: '3px',
            w: '16px',
            h: '16px',
            borderRadius: '999px',
            bg: 'surface',
            transition: 'left 0.15s',
        },
    },
    variants: {
        on: {
            true: { bg: 'primary', _after: { left: '21px' } },
            false: { bg: 'border', _after: { left: '3px' } },
        },
    },
});

const note = css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.6' });

/** 見出しと説明つきのオン・オフ。 */
export function Switch({
    title,
    description,
    on,
    disabled,
    onChange,
}: {
    title: string;
    description: string;
    on: boolean;
    disabled: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <div className={css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '3' })}>
            <div>
                <p className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>{title}</p>
                <p className={note}>{description}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={title}
                disabled={disabled}
                className={toggle({ on })}
                onClick={() => onChange(!on)}
            />
        </div>
    );
}
