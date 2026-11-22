import { type InitialEntity, LIMITS } from '@ubichill/shared';
import { useEffect, useRef, useState } from 'react';
import { css } from '@/styled-system/css';
import { inputStyle } from './shared';

interface EntityHeaderProps {
    entity: InitialEntity;
    onDelete: () => void;
    onRename: (id: string) => void;
    onSetName: (name: string) => void;
}

/**
 * Inspector のヘッダー: 表示名（日本語も可）と、参照に使う ID をそれぞれ押して編集できる。削除ボタンも持つ。
 */
export function EntityHeader({ entity, onDelete, onRename, onSetName }: EntityHeaderProps) {
    return (
        <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '2' })}>
            <div className={css({ flex: 1, minW: 0, display: 'flex', flexDirection: 'column' })}>
                <InlineEdit
                    name="entity-name"
                    value={entity.name ?? ''}
                    placeholder={entity.id}
                    maxLength={LIMITS.MAX_ENTITY_NAME_LENGTH}
                    title="押して名前を変える（空にすると ID を出す）"
                    display={entity.name || entity.id}
                    onCommit={(next) => {
                        if (next !== (entity.name ?? '')) onSetName(next);
                    }}
                    textClass={nameText}
                />
                <InlineEdit
                    name="entity-id"
                    value={entity.id}
                    placeholder={entity.id}
                    maxLength={50}
                    title="押して ID を変える（ワープの行き先などの参照に使う。参照も付け替える）"
                    display={`ID: ${entity.id}`}
                    onCommit={(next) => {
                        if (next && next !== entity.id) onRename(next);
                    }}
                    textClass={idText}
                />
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

function InlineEdit({
    name,
    value,
    placeholder,
    maxLength,
    title,
    display,
    onCommit,
    textClass,
}: {
    name: string;
    value: string;
    placeholder: string;
    maxLength: number;
    title: string;
    display: string;
    onCommit: (next: string) => void;
    textClass: string;
}) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!editing) setDraft(value);
    }, [value, editing]);

    useEffect(() => {
        if (editing) inputRef.current?.select();
    }, [editing]);

    const commit = () => {
        onCommit(draft.trim());
        setEditing(false);
    };

    return editing ? (
        <input
            ref={inputRef}
            type="text"
            name={name}
            value={draft}
            placeholder={placeholder}
            maxLength={maxLength}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
                // 日本語の変換を決める Enter では閉じない
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
                else if (e.key === 'Escape') {
                    setDraft(value);
                    setEditing(false);
                }
            }}
            className={inputStyle}
        />
    ) : (
        <button type="button" onClick={() => setEditing(true)} title={title} className={textClass}>
            {display}
        </button>
    );
}

const editableText = {
    bg: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    _hover: { color: 'primary' },
} as const;

const nameText = css({ ...editableText, fontSize: '14px', fontWeight: '600', color: 'text', padding: '4px 0' });
const idText = css({ ...editableText, fontSize: '11px', fontFamily: 'mono', color: 'textSubtle', padding: '0 0 2px' });
