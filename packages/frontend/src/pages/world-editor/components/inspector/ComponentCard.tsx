import { useEditorSchema } from '@ubichill/react';
import type { EntityComponentDef, InitialEntity } from '@ubichill/shared';
import { useEffect, useMemo, useState } from 'react';
import { css } from '@/styled-system/css';
import type { AvailableEntityKind, DataFields } from '../../hooks/useAvailableEntityKinds';
import { COMPONENT_DRAG_MIME } from '../../lib/dnd';
import { DataFormFields } from './DataFormFields';
import { Chevron, MiniTab } from './primitives';
import { inputStyle, textareaStyle } from './shared';

interface ComponentCardProps {
    component: EntityComponentDef;
    componentIndex: number;
    dataFields?: DataFields;
    /** このコンポーネント型が既知（マニフェストに存在）か。既知なら未宣言キーの追加を禁止する。 */
    known: boolean;
    initiallyExpanded: boolean;
    onChange: (updater: (prev: InitialEntity) => InitialEntity) => void;
    onDelete: () => void;
}

/** 既知だがスキーマを持たない（= 編集可能設定が無い）コンポーネント用の空スキーマ（参照固定）。 */
const EMPTY_SCHEMA: DataFields = {};

/**
 * 1 Component のアコーディオン Card。
 * 開閉ヘッダー + 開いた時の中身 (フォーム / JSON タブ切替) を持つ。
 */
export function ComponentCard({
    component,
    componentIndex,
    dataFields,
    known,
    initiallyExpanded,
    onChange,
    onDelete,
}: ComponentCardProps) {
    const [expanded, setExpanded] = useState(initiallyExpanded);

    // 編集可能パラメータの正本は worker の Ubi.state（起動時にホストへ報告）。
    // プレビューで worker が走ると registry に届くのでそれを最優先。届くまでは
    // マニフェスト由来の dataFields をフォールバックに使う。
    // 既知コンポーネントでスキーマが無い場合は空スキーマ（= 自由なキー追加を禁止）。
    // 未知コンポーネントのみ undefined（自由入力可）にする。
    const runtimeSchema = useEditorSchema(component.type) as DataFields | undefined;
    const fields = runtimeSchema ?? dataFields ?? (known ? EMPTY_SCHEMA : undefined);

    useEffect(() => {
        if (initiallyExpanded) setExpanded(true);
    }, [initiallyExpanded]);

    return (
        <div
            className={css({
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                bg: 'background',
                overflow: 'hidden',
            })}
        >
            <div
                onClick={() => setExpanded((p) => !p)}
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 10px',
                    cursor: 'pointer',
                    _hover: { bg: 'surfaceHover' },
                })}
            >
                <Chevron open={expanded} />
                <span className={css({ flex: 1, fontSize: '13px', fontWeight: '600', color: 'text' })}>
                    {component.type}
                </span>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    title="このコンポーネントを削除"
                    className={css({
                        width: '22px',
                        height: '22px',
                        bg: 'transparent',
                        color: 'errorText',
                        border: '1px solid',
                        borderColor: 'border',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        _hover: { borderColor: 'errorLight' },
                    })}
                >
                    ×
                </button>
            </div>
            {expanded && (
                <div
                    className={css({
                        padding: '10px',
                        borderTop: '1px solid',
                        borderColor: 'border',
                        bg: 'surface',
                    })}
                >
                    <ComponentDataEditor
                        component={component}
                        componentIndex={componentIndex}
                        dataFields={fields}
                        onChange={onChange}
                    />
                </div>
            )}
        </div>
    );
}

// ============================================
// フォーム / JSON タブ切替
// ============================================

function ComponentDataEditor({
    component,
    componentIndex,
    dataFields,
    onChange,
}: {
    component: EntityComponentDef;
    componentIndex: number;
    dataFields?: DataFields;
    onChange: (updater: (prev: InitialEntity) => InitialEntity) => void;
}) {
    const [dataTab, setDataTab] = useState<'form' | 'json'>('form');
    const [jsonText, setJsonText] = useState(() => JSON.stringify(component.data ?? {}, null, 2));
    const [jsonError, setJsonError] = useState('');

    useEffect(() => {
        setJsonText(JSON.stringify(component.data ?? {}, null, 2));
        setJsonError('');
    }, [component]);

    const data = (component.data as Record<string, unknown> | undefined) ?? {};
    const setData = (next: Record<string, unknown>) => {
        onChange((prev) => ({
            ...prev,
            components: prev.components.map((c, i) => (i === componentIndex ? { ...c, data: next } : c)),
        }));
        setJsonText(JSON.stringify(next, null, 2));
        setJsonError('');
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            <div className={css({ display: 'flex', gap: '4px', alignSelf: 'flex-end' })}>
                <MiniTab active={dataTab === 'form'} onClick={() => setDataTab('form')} label="フォーム" />
                <MiniTab active={dataTab === 'json'} onClick={() => setDataTab('json')} label="JSON" />
            </div>
            {dataTab === 'form' ? (
                <DataFormFields data={data} dataFields={dataFields} onChange={setData} />
            ) : (
                <DataJsonField
                    text={jsonText}
                    error={jsonError}
                    onChange={(text) => {
                        setJsonText(text);
                        try {
                            const parsed = JSON.parse(text || '{}') as Record<string, unknown>;
                            onChange((prev) => ({
                                ...prev,
                                components: prev.components.map((c, i) =>
                                    i === componentIndex ? { ...c, data: parsed } : c,
                                ),
                            }));
                            setJsonError('');
                        } catch (err) {
                            setJsonError(err instanceof Error ? err.message : 'JSON parse error');
                        }
                    }}
                />
            )}
        </div>
    );
}

function DataJsonField({ text, error, onChange }: { text: string; error: string; onChange: (text: string) => void }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
            <textarea
                value={text}
                onChange={(e) => onChange(e.target.value)}
                rows={8}
                spellCheck={false}
                className={textareaStyle}
            />
            {error && <span className={css({ fontSize: '11px', color: 'errorText' })}>{error}</span>}
        </div>
    );
}

// ============================================
// 新規 Component 追加ピッカー (drag-drop 対応)
// ============================================

interface ComponentPickerProps {
    availableKinds: AvailableEntityKind[];
    onAdd: (type: string) => void;
}

export function ComponentPicker({ availableKinds, onAdd }: ComponentPickerProps) {
    const [type, setType] = useState('');
    const [dragOver, setDragOver] = useState(false);
    const candidates = useMemo(() => availableKinds.map((k) => k.kind).sort(), [availableKinds]);

    const handleAdd = () => {
        if (!type) return;
        onAdd(type);
        setType('');
    };

    return (
        <div
            onDragOver={(e) => {
                if (e.dataTransfer.types.includes(COMPONENT_DRAG_MIME)) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                    setDragOver(true);
                }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                const ctype = e.dataTransfer.getData(COMPONENT_DRAG_MIME);
                setDragOver(false);
                if (!ctype) return;
                e.preventDefault();
                onAdd(ctype);
            }}
            className={css({
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '6px',
                pt: '2',
                borderTop: '1px dashed',
                borderColor: 'border',
                outline: dragOver ? '2px dashed' : 'none',
                outlineColor: 'primary',
                outlineOffset: '2px',
                borderRadius: '4px',
            })}
        >
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputStyle}>
                <option value="">+ コンポーネントを選択...</option>
                {candidates.map((k) => (
                    <option key={k} value={k}>
                        {k}
                    </option>
                ))}
            </select>
            <button
                type="button"
                onClick={handleAdd}
                disabled={!type}
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
                追加
            </button>
        </div>
    );
}
