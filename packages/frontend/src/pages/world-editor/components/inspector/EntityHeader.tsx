import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useRef, useState } from 'react';
import { css } from '@/styled-system/css';
import { inputStyle } from './shared';

interface EntityHeaderProps {
    entity: InitialEntity;
    onDelete: () => void;
    onRename: (id: string) => void;
}

/**
 * Inspector のヘッダー: Entity の ID をクリック編集できて、削除ボタンも持つ。
 */
export function EntityHeader({ entity, onDelete, onRename }: EntityHeaderProps) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(entity.id);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(entity.id);
    }, [entity.id, editing]);

    useEffect(() => {
        if (editing) inputRef.current?.focus();
    }, [editing]);

    const commit = () => {
        const next = draft.trim();
        if (next && next !== entity.id) onRename(next);
        setEditing(false);
    };

    return (
        <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2' })}>
            <div className={css({ flex: 1, minW: 0 })}>
                {editing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        name="entity-id"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commit();
                            else if (e.key === 'Escape') {
                                setDraft(entity.id);
                                setEditing(false);
                            }
                        }}
                        className={inputStyle}
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        title="クリックして ID を編集"
                        className={css({
                            fontSize: '14px',
                            fontWeight: '700',
                            color: 'text',
                            bg: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 0',
                            textAlign: 'left',
                            width: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            _hover: { color: 'primary' },
                        })}
                    >
                        {entity.id}
                    </button>
                )}
            </div>
            <button
                type="button"
                onClick={onDelete}
                className={css({
                    padding: '6px 12px',
                    bg: 'errorBg',
                    color: 'errorText',
                    border: '1px solid',
                    borderColor: 'errorLight',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    _hover: { opacity: 0.9 },
                })}
            >
                削除
            </button>
        </div>
    );
}
