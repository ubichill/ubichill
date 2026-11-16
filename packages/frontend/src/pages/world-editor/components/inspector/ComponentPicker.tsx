import { useEffect, useMemo, useRef, useState } from 'react';
import { PreviewImage } from '@/components/mods/PreviewImage';
import { css, cx } from '@/styled-system/css';
import type { AvailableEntityKind } from '../../hooks/useAvailableEntityKinds';
import { componentPickerItems } from '../../lib/componentPicker';
import { COMPONENT_DRAG_MIME } from '../../lib/dnd';

interface ComponentPickerProps {
    availableKinds: AvailableEntityKind[];
    onAdd: (type: string) => void;
}

const thumbBox = css({
    width: '40px',
    height: '40px',
    flexShrink: 0,
    bg: 'surface',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    color: 'textSubtle',
});

/**
 * 新しい Component の追加。押すと見た目の画像つきの一覧を開き、選ぶとそのまま追加する。
 * アセット欄の Component をここへドラッグしても追加できる。
 */
export function ComponentPicker({ availableKinds, onAdd }: ComponentPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    const items = useMemo(() => componentPickerItems(availableKinds, query), [availableKinds, query]);

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent | KeyboardEvent) => {
            if (e instanceof KeyboardEvent ? e.key === 'Escape' : !root.current?.contains(e.target as Node))
                setOpen(false);
        };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', close);
        return () => {
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', close);
        };
    }, [open]);

    const add = (type: string) => {
        onAdd(type);
        setOpen(false);
        setQuery('');
    };

    return (
        <div
            ref={root}
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDragOver(true);
                }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                const type = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                setDragOver(false);
                if (!type) return;
                e.preventDefault();
                onAdd(type);
            }}
            className={css({
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                pt: '8px',
                borderTopWidth: '1px',
                borderTopStyle: 'dashed',
                borderTopColor: 'border',
                outline: dragOver ? '2px dashed' : 'none',
                outlineColor: 'primary',
                outlineOffset: '2px',
                borderRadius: '4px',
            })}
        >
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={css({
                    width: '100%',
                    p: '8px 12px',
                    bg: 'background',
                    color: 'text',
                    border: '1px solid',
                    borderColor: open ? 'primary' : 'border',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: '600',
                    textAlign: 'left',
                    cursor: 'pointer',
                    _hover: { borderColor: 'primary' },
                })}
            >
                コンポーネントを追加
            </button>
            {open && (
                <div
                    className={css({
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '8px',
                        bg: 'background',
                        overflow: 'hidden',
                    })}
                >
                    <input
                        type="search"
                        // biome-ignore lint/a11y/noAutofocus: 開いた一覧の絞り込みにすぐ入力できるようにする
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="名前・型で絞り込む"
                        aria-label="追加する Component を絞り込む"
                        className={css({
                            width: '100%',
                            p: '8px 12px',
                            fontSize: '13px',
                            bg: 'transparent',
                            color: 'text',
                            border: 'none',
                            borderBottomWidth: '1px',
                            borderBottomStyle: 'solid',
                            borderBottomColor: 'border',
                            outline: 'none',
                        })}
                    />
                    <ul aria-label="追加できる Component" className={css({ maxHeight: '320px', overflowY: 'auto' })}>
                        {items.map(({ kind, label }) => (
                            <li key={kind.kind}>
                                <button
                                    type="button"
                                    onClick={() => add(kind.kind)}
                                    className={css({
                                        width: '100%',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '12px',
                                        p: '8px 12px',
                                        bg: 'transparent',
                                        border: 'none',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        _hover: { bg: 'surfaceAccent' },
                                        _focusVisible: { bg: 'surfaceAccent', outline: 'none' },
                                    })}
                                >
                                    <span className={thumbBox}>
                                        <PreviewImage source={kind.thumbnail} alt="" fallback={<KindIcon />} />
                                    </span>
                                    <span className={css({ minWidth: 0 })}>
                                        <span
                                            className={css({
                                                display: 'block',
                                                fontSize: '13px',
                                                fontWeight: '600',
                                                color: 'text',
                                            })}
                                        >
                                            {label}
                                        </span>
                                        <span
                                            className={cx(
                                                css({ display: 'block', fontSize: '11px', color: 'textSubtle' }),
                                                css({ overflowWrap: 'anywhere' }),
                                            )}
                                        >
                                            {kind.kind}
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                    {items.length === 0 && (
                        <p className={css({ p: '12px', fontSize: '13px', color: 'textMuted' })}>
                            {query ? '一致する Component はありません' : '追加できる Component がありません'}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function KindIcon() {
    return (
        <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
        >
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
    );
}
