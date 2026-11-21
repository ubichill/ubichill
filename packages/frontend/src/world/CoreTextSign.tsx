import { TextDataSchema } from '@ubichill/core-components';
import type { ComponentInstance } from '@ubichill/shared';
import type React from 'react';
import { cva } from '@/styled-system/css';
import { surfacePlacement } from './surfacePlacement';

/**
 * `core:text` の面。ワールド作者が置いた文字（看板・案内）を描く。色と大きさは作者が決めるので style で渡す
 * （どちらも schema で #RRGGBB・数値に限っている）。文字がまだ無ければ枠だけ出す。
 */
export const CoreTextSign: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const parsed = TextDataSchema.safeParse(entity.data ?? {});
    const entityId = entity.entityId ?? entity.id;
    if (!parsed.success) return null;
    const { text, size, color, background, align, bold } = parsed.data;
    const empty = text.trim() === '';
    return (
        <div
            data-text-sign={entityId}
            className={sign({ align, bold, empty })}
            style={{
                ...surfacePlacement(entity),
                color,
                fontSize: size,
                backgroundColor: background === 'transparent' ? undefined : background,
            }}
        >
            {empty ? '文字' : text}
        </div>
    );
};

const sign = cva({
    base: {
        px: '0.6em',
        py: '0.3em',
        borderRadius: '8px',
        lineHeight: '1.5',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        wordBreak: 'auto-phrase',
    },
    variants: {
        align: { left: { textAlign: 'left' }, center: { textAlign: 'center' }, right: { textAlign: 'right' } },
        bold: { true: { fontWeight: 'bold' }, false: { fontWeight: 'normal' } },
        empty: { true: { border: '2px dashed', borderColor: 'borderStrong', opacity: 0.6 }, false: {} },
    },
});
