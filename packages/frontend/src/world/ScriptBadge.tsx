import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { css } from '@/styled-system/css';
import { useEditorPreview } from './editorPreview';
import { surfacePlacement } from './surfacePlacement';

/**
 * UI のボタンで動くスクリプトの印。部屋では描かない（見た目は UI が持つ）。エディタでは、どの Entity に何が付いているかが
 * 分かるように、右下に小さな名札を出す（文字や絵は左上から置かれることが多いので、隠しにくい）。
 */
export const ScriptBadge: React.FC<{ entity: ComponentInstance; label: string; icon: React.ReactNode }> = ({
    entity,
    label,
    icon,
}) => {
    const editing = useEditorPreview();
    if (!editing) return null;
    return (
        <div aria-hidden="true" style={{ ...surfacePlacement(entity), pointerEvents: 'none' }} className={corner}>
            <span className={tag}>
                {icon}
                <span className={tagText}>{label}</span>
            </span>
        </div>
    );
};

const corner = css({ display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', p: '1' });

const tag = css({
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

const tagText = css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
