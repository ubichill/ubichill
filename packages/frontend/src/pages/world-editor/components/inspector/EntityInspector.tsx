import type { EntityComponentDef, InitialEntity } from '@ubichill/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@/styled-system/css';
import type { AvailableEntityKind, DataFieldSpec, DataFields } from '../../hooks/useAvailableEntityKinds';
import { COMPONENT_DRAG_MIME } from '../../lib/dnd';

interface EntityInspectorProps {
    entity: InitialEntity;
    /** Hierarchy 等から渡される「最初に展開しておく Component の index」。 */
    initiallyExpandedComponentIndex: number | null;
    availableKinds: AvailableEntityKind[];
    /** true なら子 Entity (transform は親基準の相対座標) */
    isChild: boolean;
    /** W/H の上限として使うワールドサイズ。 */
    worldSize?: { width: number; height: number };
    onChange: (updater: (prev: InitialEntity) => InitialEntity) => void;
    onAddComponent: (type: string) => void;
    onDeleteComponent: (componentIndex: number) => void;
    onDeleteEntity: () => void;
    onRenameEntity: (newId: string) => void;
}

export function EntityInspector({
    entity,
    initiallyExpandedComponentIndex,
    availableKinds,
    isChild,
    worldSize,
    onChange,
    onAddComponent,
    onDeleteComponent,
    onDeleteEntity,
    onRenameEntity,
}: EntityInspectorProps) {
    const t = entity.transform;
    const updateTransform = (patch: Partial<typeof t>) =>
        onChange((prev) => ({ ...prev, transform: { ...prev.transform, ...patch } }));
    const maxW = worldSize?.width;
    const maxH = worldSize?.height;

    return (
        <div
            className={css({
                bg: 'surface',
                borderRadius: '12px',
                p: '4',
                display: 'flex',
                flexDirection: 'column',
                gap: '4',
            })}
        >
            <EntityHeader entity={entity} onDelete={onDeleteEntity} onRename={onRenameEntity} />

            <Section label={isChild ? 'Transform (親基準)' : 'Transform'}>
                <div className={css({ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2' })}>
                    <NumField label="X" value={t.x} onChange={(v) => updateTransform({ x: v })} />
                    <NumField label="Y" value={t.y} onChange={(v) => updateTransform({ y: v })} />
                    <NumField
                        label="W"
                        value={t.w ?? 0}
                        max={maxW}
                        onChange={(v) => updateTransform({ w: v || undefined })}
                    />
                    <NumField
                        label="H"
                        value={t.h ?? 0}
                        max={maxH}
                        onChange={(v) => updateTransform({ h: v || undefined })}
                    />
                    <NumField label="Z" value={t.z ?? 0} onChange={(v) => updateTransform({ z: v })} />
                    <NumField
                        label="Rotation"
                        value={t.rotation ?? 0}
                        onChange={(v) => updateTransform({ rotation: v })}
                    />
                </div>
            </Section>

            <Section label="Tags">
                <TagsEditor
                    tags={entity.tags ?? []}
                    onChange={(next) => onChange((prev) => ({ ...prev, tags: next }))}
                />
            </Section>

            <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                <div className={css({ fontSize: '12px', fontWeight: '600', color: 'text' })}>Components</div>
                {entity.components.length === 0 ? (
                    <div className={css({ fontSize: '12px', color: 'textSubtle' })}>
                        コンポーネントがありません。下から追加するか、アセットからドロップしてください。
                    </div>
                ) : (
                    entity.components.map((c, ci) => (
                        <ComponentCard
                            key={`${c.type}-${ci}`}
                            component={c}
                            componentIndex={ci}
                            dataFields={availableKinds.find((k) => k.kind === c.type)?.dataFields}
                            initiallyExpanded={ci === initiallyExpandedComponentIndex}
                            onChange={onChange}
                            onDelete={() => onDeleteComponent(ci)}
                        />
                    ))
                )}
                <ComponentPicker availableKinds={availableKinds} onAdd={onAddComponent} />
            </div>
        </div>
    );
}

// ============================================
// Component カード (Unity 風アコーディオン)
// ============================================

interface ComponentCardProps {
    component: EntityComponentDef;
    componentIndex: number;
    dataFields?: DataFields;
    initiallyExpanded: boolean;
    onChange: (updater: (prev: InitialEntity) => InitialEntity) => void;
    onDelete: () => void;
}

function ComponentCard({
    component,
    componentIndex,
    dataFields,
    initiallyExpanded,
    onChange,
    onDelete,
}: ComponentCardProps) {
    const [expanded, setExpanded] = useState(initiallyExpanded);

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
                        dataFields={dataFields}
                        onChange={onChange}
                    />
                </div>
            )}
        </div>
    );
}

// ============================================
// Component data エディタ (フォーム + JSON タブ)
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

// ============================================
// Component 追加ピッカー (重複可)
// ============================================

function ComponentPicker({
    availableKinds,
    onAdd,
}: {
    availableKinds: AvailableEntityKind[];
    onAdd: (type: string) => void;
}) {
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

// ============================================
// Tags
// ============================================

const TAG_PATTERN = /^[a-z0-9_-]+$/;

function TagsEditor({ tags, onChange }: { tags: string[]; onChange: (next: string[]) => void }) {
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

// ============================================
// Entity ヘッダー: 名前リネーム + 削除
// ============================================

function EntityHeader({
    entity,
    onDelete,
    onRename,
}: {
    entity: InitialEntity;
    onDelete: () => void;
    onRename: (id: string) => void;
}) {
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

// ============================================
// Data フォーム編集
// ============================================

function DataFormFields({
    data,
    dataFields,
    onChange,
}: {
    data: Record<string, unknown>;
    dataFields?: DataFields;
    onChange: (next: Record<string, unknown>) => void;
}) {
    const setField = (key: string, value: unknown) => onChange({ ...data, [key]: value });
    const deleteField = (key: string) => {
        const next = { ...data };
        delete next[key];
        onChange(next);
    };

    const declaredKeys = useMemo(() => Object.keys(dataFields ?? {}), [dataFields]);
    const customKeys = useMemo(() => {
        const declared = new Set(declaredKeys);
        return Object.keys(data).filter((k) => !declared.has(k));
    }, [data, declaredKeys]);

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            {declaredKeys.length > 0 && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
                    {declaredKeys.map((key) => {
                        const spec = dataFields?.[key];
                        if (!spec) return null;
                        const value = key in data ? data[key] : (spec.default ?? defaultForType(spec));
                        return (
                            <DeclaredFieldRow
                                key={key}
                                fieldKey={key}
                                spec={spec}
                                value={value}
                                onChange={(v) => setField(key, v)}
                                onReset={() => setField(key, spec.default ?? defaultForType(spec))}
                            />
                        );
                    })}
                </div>
            )}

            {customKeys.length > 0 && (
                <div
                    className={css({
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2',
                        pt: '3',
                        borderTop: declaredKeys.length > 0 ? '1px dashed' : 'none',
                        borderColor: 'border',
                    })}
                >
                    {declaredKeys.length > 0 && (
                        <span
                            className={css({
                                fontSize: '11px',
                                color: 'textSubtle',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                            })}
                        >
                            カスタム
                        </span>
                    )}
                    {customKeys.map((key) => (
                        <CustomFieldRow
                            key={key}
                            fieldKey={key}
                            value={data[key]}
                            onChange={(v) => setField(key, v)}
                            onDelete={() => deleteField(key)}
                        />
                    ))}
                </div>
            )}

            {declaredKeys.length === 0 && customKeys.length === 0 && (
                <div className={css({ fontSize: '12px', color: 'textSubtle' })}>
                    {dataFields === undefined
                        ? 'プラグインが data フィールドを宣言していません。下から自由にキーを追加できます（プラグインが読まない可能性があります）。'
                        : 'このコンポーネントはデータを必要としません。'}
                </div>
            )}

            {dataFields === undefined && (
                <AddFieldRow existing={new Set(Object.keys(data))} onAdd={(k, v) => onChange({ ...data, [k]: v })} />
            )}
        </div>
    );
}

function DeclaredFieldRow({
    fieldKey,
    spec,
    value,
    onChange,
    onReset,
}: {
    fieldKey: string;
    spec: DataFieldSpec;
    value: unknown;
    onChange: (v: unknown) => void;
    onReset: () => void;
}) {
    const label = spec.label ?? fieldKey;
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
            <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
                <span className={css({ fontSize: '12px', fontWeight: '600', color: 'text' })}>
                    {label}
                    <span className={css({ ml: '6px', fontSize: '10px', color: 'textSubtle', fontWeight: '500' })}>
                        ({fieldKey} · {spec.type})
                    </span>
                </span>
                <button
                    type="button"
                    onClick={onReset}
                    title="既定値に戻す"
                    className={css({
                        fontSize: '10px',
                        color: 'textSubtle',
                        bg: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        _hover: { color: 'primary' },
                    })}
                >
                    ↻
                </button>
            </div>
            <DeclaredInput spec={spec} value={value} onChange={onChange} />
            {spec.help && <span className={css({ fontSize: '10px', color: 'textSubtle' })}>{spec.help}</span>}
        </div>
    );
}

function DeclaredInput({
    spec,
    value,
    onChange,
}: {
    spec: DataFieldSpec;
    value: unknown;
    onChange: (v: unknown) => void;
}) {
    if (spec.type === 'string') {
        const s = String(value ?? '');
        if (spec.multiline) {
            return (
                <textarea
                    value={s}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={spec.placeholder}
                    rows={3}
                    className={textareaStyle}
                />
            );
        }
        return (
            <input
                type="text"
                value={s}
                onChange={(e) => onChange(e.target.value)}
                placeholder={spec.placeholder}
                className={inputStyle}
            />
        );
    }
    if (spec.type === 'url') {
        return (
            <input
                type="url"
                value={String(value ?? '')}
                onChange={(e) => onChange(e.target.value)}
                placeholder={spec.placeholder ?? 'https://...'}
                className={inputStyle}
            />
        );
    }
    if (spec.type === 'number') {
        return (
            <input
                type="number"
                value={typeof value === 'number' ? value : 0}
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
                className={inputStyle}
            />
        );
    }
    if (spec.type === 'boolean') {
        const v = Boolean(value);
        return (
            <label className={css({ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px' })}>
                <input type="checkbox" checked={v} onChange={(e) => onChange(e.target.checked)} />
                <span className={css({ color: 'textMuted' })}>{v ? 'true' : 'false'}</span>
            </label>
        );
    }
    if (spec.type === 'color') {
        const v = typeof value === 'string' ? value : '#000000';
        return (
            <div className={css({ display: 'flex', gap: '6px', alignItems: 'center' })}>
                <input
                    type="color"
                    value={v}
                    onChange={(e) => onChange(e.target.value)}
                    className={css({
                        width: '40px',
                        height: '32px',
                        borderRadius: '6px',
                        border: '1px solid',
                        borderColor: 'border',
                        cursor: 'pointer',
                    })}
                />
                <input type="text" value={v} onChange={(e) => onChange(e.target.value)} className={inputStyle} />
            </div>
        );
    }
    if (spec.type === 'enum') {
        return (
            <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={inputStyle}>
                {spec.options.map((o) => (
                    <option key={o} value={o}>
                        {o}
                    </option>
                ))}
            </select>
        );
    }
    return <MiniJsonEditor value={value} onChange={onChange} />;
}

function CustomFieldRow({
    fieldKey,
    value,
    onChange,
    onDelete,
}: {
    fieldKey: string;
    value: unknown;
    onChange: (v: unknown) => void;
    onDelete: () => void;
}) {
    const type = detectType(value);
    return (
        <div
            className={css({
                display: 'grid',
                gridTemplateColumns: '110px 1fr auto',
                gap: '6px',
                alignItems: 'start',
            })}
        >
            <span
                className={css({
                    fontSize: '12px',
                    color: 'text',
                    fontWeight: '600',
                    pt: '6px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                })}
                title={fieldKey}
            >
                {fieldKey}
            </span>
            {type === 'boolean' ? (
                <label className={css({ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px' })}>
                    <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
                    <span className={css({ color: 'textMuted' })}>{value ? 'true' : 'false'}</span>
                </label>
            ) : type === 'number' ? (
                <input
                    type="number"
                    value={Number(value)}
                    onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
                    className={inputStyle}
                />
            ) : type === 'string' ? (
                <input
                    type="text"
                    value={String(value)}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputStyle}
                />
            ) : (
                <MiniJsonEditor value={value} onChange={onChange} />
            )}
            <button
                type="button"
                onClick={onDelete}
                title="このフィールドを削除"
                className={css({
                    padding: '4px 8px',
                    bg: 'transparent',
                    color: 'errorText',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '6px',
                    fontSize: '11px',
                    cursor: 'pointer',
                    _hover: { borderColor: 'errorLight' },
                })}
            >
                ×
            </button>
        </div>
    );
}

function MiniJsonEditor({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
    const [text, setText] = useState(() => JSON.stringify(value, null, 2));
    const [err, setErr] = useState('');
    useEffect(() => {
        setText(JSON.stringify(value, null, 2));
        setErr('');
    }, [value]);
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
            <textarea
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    try {
                        const parsed = JSON.parse(e.target.value || 'null') as unknown;
                        onChange(parsed);
                        setErr('');
                    } catch (er) {
                        setErr(er instanceof Error ? er.message : 'JSON parse error');
                    }
                }}
                rows={3}
                spellCheck={false}
                className={textareaStyle}
            />
            {err && <span className={css({ fontSize: '10px', color: 'errorText' })}>{err}</span>}
        </div>
    );
}

function AddFieldRow({ existing, onAdd }: { existing: Set<string>; onAdd: (name: string, value: unknown) => void }) {
    const [name, setName] = useState('');
    const [type, setType] = useState<'string' | 'number' | 'boolean' | 'json'>('string');

    const handleAdd = () => {
        const trimmed = name.trim();
        if (!trimmed || existing.has(trimmed)) return;
        const initial: unknown = type === 'string' ? '' : type === 'number' ? 0 : type === 'boolean' ? false : {};
        onAdd(trimmed, initial);
        setName('');
        setType('string');
    };

    return (
        <div
            className={css({
                display: 'grid',
                gridTemplateColumns: '110px 1fr auto auto',
                gap: '6px',
                pt: '3',
                borderTop: '1px dashed',
                borderColor: 'border',
            })}
        >
            <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAdd();
                    }
                }}
                placeholder="フィールド名"
                className={inputStyle}
            />
            <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputStyle}>
                <option value="string">文字列</option>
                <option value="number">数値</option>
                <option value="boolean">真偽値</option>
                <option value="json">JSON</option>
            </select>
            <button
                type="button"
                onClick={handleAdd}
                disabled={!name.trim() || existing.has(name.trim())}
                className={css({
                    padding: '6px 12px',
                    bg: 'primary',
                    color: 'textOnPrimary',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                    _hover: { opacity: 0.9 },
                })}
            >
                + 追加
            </button>
            <span />
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
                className={css({
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: '1.5px solid',
                    borderColor: 'border',
                    bg: 'background',
                    color: 'text',
                    fontFamily: 'mono',
                    fontSize: '12px',
                    outline: 'none',
                    resize: 'vertical',
                    _focus: { borderColor: 'primary' },
                })}
            />
            {error && <span className={css({ fontSize: '11px', color: 'errorText' })}>{error}</span>}
        </div>
    );
}

// ============================================
// 共通: NumField / Section / MiniTab / Chevron
// ============================================

function NumField({
    label,
    value,
    max,
    onChange,
}: {
    label: string;
    value: number;
    max?: number;
    onChange: (v: number) => void;
}) {
    return (
        <label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
            <span className={css({ fontSize: '11px', color: 'textMuted' })}>{label}</span>
            <input
                type="number"
                value={value}
                max={max}
                onChange={(e) => {
                    const parsed = Number.parseFloat(e.target.value) || 0;
                    onChange(max !== undefined ? Math.min(parsed, max) : parsed);
                }}
                className={inputStyle}
            />
        </label>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            <div className={css({ fontSize: '12px', fontWeight: '600', color: 'text' })}>{label}</div>
            {children}
        </div>
    );
}

function MiniTab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={css({
                padding: '3px 8px',
                bg: active ? 'primary' : 'background',
                color: active ? 'textOnPrimary' : 'textMuted',
                border: '1px solid',
                borderColor: active ? 'primary' : 'border',
                borderRadius: '6px',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
                _hover: { opacity: 0.9 },
            })}
        >
            {label}
        </button>
    );
}

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            aria-hidden="true"
        >
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}

function detectType(v: unknown): 'string' | 'number' | 'boolean' | 'json' {
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'boolean';
    return 'json';
}

function defaultForType(spec: DataFieldSpec): unknown {
    switch (spec.type) {
        case 'string':
        case 'url':
            return '';
        case 'number':
            return 0;
        case 'boolean':
            return false;
        case 'color':
            return '#000000';
        case 'enum':
            return spec.options[0] ?? '';
        case 'json':
            return null;
    }
}

const inputStyle = css({
    width: '100%',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontSize: '12px',
    outline: 'none',
    _focus: { borderColor: 'primary' },
});

const textareaStyle = css({
    width: '100%',
    padding: '6px 8px',
    borderRadius: '6px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontFamily: 'mono',
    fontSize: '11px',
    outline: 'none',
    resize: 'vertical',
    _focus: { borderColor: 'primary' },
});
