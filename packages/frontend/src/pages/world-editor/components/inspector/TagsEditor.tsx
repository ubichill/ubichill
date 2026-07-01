import { useState } from 'react';
import { css } from '@/styled-system/css';
import { inputStyle } from './shared';

const TAG_PATTERN = /^[a-z0-9_-]+$/;

interface TagsEditorProps {
    tags: string[];
    onChange: (next: string[]) => void;
}

/**
 * Entity の tags を編集するためのインライン UI。
 * - 入力は小文字英数 + `-` + `_` のみ
 * - 重複は弾く
 */
export function TagsEditor({ tags, onChange }: TagsEditorProps) {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');

    const addTag = () => {
        const next = draft.trim().toLowerCase();
        if (!next) return;
        if (!TAG_PATTERN.test(next)) {
            setError('小文字英数 + - _ のみ');
            return;
        }
        if (tags.includes(next)) {
            setError('既に追加済み');
            return;
        }
        onChange([...tags, next]);
        setDraft('');
        setError('');
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            {tags.length > 0 && (
                <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '4px' })}>
                    {tags.map((t) => (
                        <span
                            key={t}
                            className={css({
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                padding: '3px 6px 3px 8px',
                                bg: 'primarySubtle',
                                color: 'primary',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: '600',
                            })}
                        >
                            {t}
                            <button
                                type="button"
                                onClick={() => onChange(tags.filter((x) => x !== t))}
                                aria-label={`${t} を削除`}
                                className={css({
                                    width: '16px',
                                    height: '16px',
                                    bg: 'transparent',
                                    border: 'none',
                                    color: 'primary',
                                    cursor: 'pointer',
                                    fontSize: '12px',
                                    lineHeight: '1',
                                    _hover: { opacity: 0.7 },
                                })}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <div className={css({ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px' })}>
                <input
                    type="text"
                    name="entity-tag-input"
                    value={draft}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setError('');
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            addTag();
                        }
                    }}
                    placeholder="tag を追加 (例: ui, background)"
                    className={inputStyle}
                />
                <button
                    type="button"
                    onClick={addTag}
                    disabled={!draft.trim()}
                    className={css({
                        padding: '6px 12px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                        _hover: { opacity: 0.9 },
                    })}
                >
                    + 追加
                </button>
            </div>
            {error && <span className={css({ fontSize: '11px', color: 'errorText' })}>{error}</span>}
        </div>
    );
}
