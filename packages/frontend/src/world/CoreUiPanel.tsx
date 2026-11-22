import { readCoreData, UiDataSchema } from '@ubichill/core-components';
import { ModUIMount, useWorld } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import { parseUiMarkup } from '@ubichill/ui-renderer';
import type React from 'react';
import { useMemo, useState } from 'react';
import { css } from '@/styled-system/css';
import { createPressGuard, entityScripts, planButtonPress, uiButtonLabel } from './entityButton';
import { surfacePlacement } from './surfacePlacement';
import { useScriptRunner } from './useScriptRunner';

/** core:ui の HTML はハンドラーを持たない（on* 属性は解析で捨てる）。届いても何もしない。 */
const ignoreAction = (): void => {};

/**
 * `core:ui`。Entity の大きさの四角（塗り・枠線・角丸）にテキストを入れる。ボタンにすると、押したときに同じ Entity の
 * スクリプト（ワープ・スイッチ・ポータル）を動かす。HTML 風の UI データ（上級者向け）を書いたときは、テキストの代わりに
 * mod の UI と同じ描画（Shadow DOM・許可リスト・URL と style の検査）で描く。
 */
export const CoreUiPanel: React.FC<{ entity: ComponentInstance }> = ({ entity }) => {
    const { entities } = useWorld();
    const runner = useScriptRunner();
    const parsed = readCoreData(UiDataSchema, entity.data ?? {});
    const data = parsed.success ? parsed.data : null;
    const markup = data?.markup ?? '';
    const vnode = useMemo(() => parseUiMarkup(markup), [markup]);
    const [guard] = useState(createPressGuard);
    const entityId = entity.entityId ?? entity.id;
    if (!data) return null;

    const box: React.CSSProperties = {
        background: data.fill,
        border: data.border === 'transparent' ? undefined : `${data.borderWidth}px solid ${data.border}`,
        borderRadius: data.radius,
    };
    const text = data.text && !markup && (
        <span
            className={textArea}
            style={{
                justifyContent: alignToFlex[data.align],
                textAlign: data.align,
                fontSize: data.size,
                color: data.color,
                fontWeight: data.bold ? 700 : 400,
            }}
        >
            {data.text}
        </span>
    );
    const html = markup && <ModUIMount targetId={entityId} vnode={vnode} sendAction={ignoreAction} />;

    if (data.button) {
        const scripts = planButtonPress(entityScripts(entities.values(), entityId));
        const ready = scripts.filter(runner.ready);
        const label = uiButtonLabel(data.text, scripts);
        return (
            <div data-ui-panel={entityId} style={{ ...surfacePlacement(entity), pointerEvents: 'auto' }}>
                <button
                    type="button"
                    className={buttonBox}
                    style={box}
                    aria-label={label}
                    disabled={ready.length === 0}
                    onClick={() => guard(() => Promise.all(ready.map((script) => runner.run(script, data.text))))}
                >
                    {text}
                    {/* ボタンの中の HTML は見た目だけ。リンクを押せるとボタンとどちらが動くか決まらない */}
                    {html && (
                        <span inert className={contents}>
                            {html}
                        </span>
                    )}
                </button>
            </div>
        );
    }
    // 押せない四角とテキストは下のものの操作を邪魔しない。HTML はリンクを押せるように入力を受け取る
    return (
        <div data-ui-panel={entityId} style={{ ...surfacePlacement(entity), pointerEvents: markup ? 'auto' : 'none' }}>
            <div className={plainBox} style={box}>
                {text}
                {html}
            </div>
        </div>
    );
};

const alignToFlex = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

const contents = css({ display: 'contents' });

const plainBox = css({ position: 'relative', w: 'full', h: 'full', boxSizing: 'border-box' });

const buttonBox = css({
    position: 'relative',
    display: 'block',
    w: 'full',
    h: 'full',
    p: '0',
    boxSizing: 'border-box',
    font: 'inherit',
    cursor: 'pointer',
    transition: 'filter 0.15s ease, transform 0.1s ease',
    _hover: { filter: 'brightness(0.96)' },
    _active: { transform: 'translateY(1px)' },
    _focusVisible: { outline: '3px solid', outlineColor: 'primaryHighlight', outlineOffset: '2px' },
    _disabled: { cursor: 'default', filter: 'none', transform: 'none' },
});

// テキストは四角の真ん中の高さに置く（FigJam の図形と同じ）。HTML は前の版と同じく左上から流す
const textArea = css({
    position: 'absolute',
    inset: '0',
    display: 'flex',
    alignItems: 'center',
    p: '3',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    overflow: 'hidden',
    pointerEvents: 'none',
});
