import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { css } from '@/styled-system/css';
import { useEditorPreview } from './editorPreview';
import { surfacePlacement } from './surfacePlacement';

/**
 * 見た目なしの押せる部品（`look: 'none'`）。何も描かず、Entity の矩形いっぱいを押せる場所にする。見た目は同じ Entity の
 * 画像・文字が描き、この場所はそれより後に描く（stackingOrder）ので上に来る。エディタでは押せる範囲を点線と名前で見せる。
 */
export const PartHitArea: React.FC<{
    entity: ComponentInstance;
    label: string;
    icon: React.ReactNode;
    disabled: boolean;
    onPress: () => void;
}> = ({ entity, label, icon, disabled, onPress }) => {
    const editing = useEditorPreview();
    return (
        <div
            data-hit-area={entity.entityId ?? entity.id}
            style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}
        >
            <button type="button" aria-label={label} className={hitArea} disabled={disabled} onClick={onPress}>
                {editing && (
                    <span aria-hidden="true" className={editorOutline}>
                        <span className={editorTag}>
                            {icon}
                            <span className={editorTagText}>{label}</span>
                        </span>
                    </span>
                )}
            </button>
        </div>
    );
};

const hitArea = css({
    position: 'relative',
    display: 'block',
    w: 'full',
    h: 'full',
    // 大きさの無い Entity でも押せるように
    minW: '44px',
    minH: '44px',
    p: '0',
    bg: 'transparent',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    _disabled: { cursor: 'default' },
    // 置き場所の枠が overflow: hidden なので、枠の内側に描く
    _focusVisible: { outline: '3px solid', outlineColor: 'primaryHighlight', outlineOffset: '-3px' },
});

const editorOutline = css({
    position: 'absolute',
    inset: '1',
    display: 'flex',
    alignItems: 'flex-start',
    p: '1',
    border: '1.5px dashed',
    borderColor: 'primaryHighlight',
    borderRadius: '6px',
    pointerEvents: 'none',
});

const editorTag = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '1',
    minW: '0',
    maxW: 'full',
    px: '1.5',
    py: '0.5',
    bg: 'chipLabelBg',
    color: 'textOnPrimary',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    lineHeight: '1.2',
});

const editorTagText = css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
