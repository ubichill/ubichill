import type { InitialEntity } from '@ubichill/shared';
import { useEffect, useMemo, useState } from 'react';
import { css } from '@/styled-system/css';
import type { DataFieldSpec, DataFields } from './useAvailableEntityKinds';

interface EntityInspectorProps {
    entity: InitialEntity;
    /** プラグインが宣言した data フィールド。これらは entity.data に値が無くても必ず表示する。 */
    dataFields?: DataFields;
    onChange: (updater: (prev: InitialEntity) => InitialEntity) => void;
    onDelete: () => void;
}

/**
 * エンティティの transform と data を編集するインスペクタ。
 *
 * data は2モード:
 * - 「フォーム」: dataFields で宣言されたフィールドは型に応じた input で必ず表示。
 *               宣言外のキーがあれば「カスタム」セクションに表示。「+ 追加」で任意キーを追加可能。
 * - 「JSON」: 生 JSON を直接編集（高度なケース用）。
 */
export function EntityInspector({ entity, dataFields, onChange, onDelete }: EntityInspectorProps) {
    const [dataTab, setDataTab] = useState<'form' | 'json'>('form');
    const [jsonText, setJsonText] = useState(() => JSON.stringify(entity.data ?? {}, null, 2));
    const [jsonError, setJsonError] = useState('');

    useEffect(() => {
        setJsonText(JSON.stringify(entity.data ?? {}, null, 2));
        setJsonError('');
    }, [entity]);

    const t = entity.transform;
    const updateTransform = (patch: Partial<typeof t>) =>
        onChange((prev) => ({ ...prev, transform: { ...prev.transform, ...patch } }));

    const data = (entity.data as Record<string, unknown> | undefined) ?? {};
    const setData = (next: Record<string, unknown>) => {
        onChange((prev) => ({ ...prev, data: next }));
        setJsonText(JSON.stringify(next, null, 2));
        setJsonError('');
    };

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
            <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center' })}>
                <div className={css({ fontSize: '14px', fontWeight: '700', color: 'text' })}>{entity.kind}</div>
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

            <Section label="位置・サイズ">
                <div className={css({ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2' })}>
                    <NumField label="X" value={t.x} onChange={(v) => updateTransform({ x: v })} />
                    <NumField label="Y" value={t.y} onChange={(v) => updateTransform({ y: v })} />
                    <NumField label="W" value={t.w ?? 0} onChange={(v) => updateTransform({ w: v || undefined })} />
                    <NumField label="H" value={t.h ?? 0} onChange={(v) => updateTransform({ h: v || undefined })} />
                    <NumField label="Z" value={t.z ?? 0} onChange={(v) => updateTransform({ z: v })} />
                    <NumField
                        label="Rotation"
                        value={t.rotation ?? 0}
                        onChange={(v) => updateTransform({ rotation: v })}
                    />
                </div>
            </Section>

            <Section
                label="データ"
                right={
                    <div className={css({ display: 'flex', gap: '4px' })}>
                        <MiniTab active={dataTab === 'form'} onClick={() => setDataTab('form')} label="フォーム" />
                        <MiniTab active={dataTab === 'json'} onClick={() => setDataTab('json')} label="JSON" />
                    </div>
                }
            >
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
                                onChange((prev) => ({ ...prev, data: parsed }));
                                setJsonError('');
                            } catch (err) {
                                setJsonError(err instanceof Error ? err.message : 'JSON parse error');
                            }
                        }}
                    />
                )}
            </Section>
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

    // 宣言フィールド (dataFields にあるキー) と カスタムキー (dataFields に無いキー) を分ける
    const declaredKeys = useMemo(() => Object.keys(dataFields ?? {}), [dataFields]);
    const customKeys = useMemo(() => {
        const declared = new Set(declaredKeys);
        return Object.keys(data).filter((k) => !declared.has(k));
    }, [data, declaredKeys]);

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            {/* 宣言フィールド: 必ず表示 */}
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

            {/* カスタムフィールド: 宣言外のキー */}
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

            {/*
                空状態の文言:
                - dataFields が宣言されていない (undefined): このプラグインは data 構造を未定義 → 自由追加を促す
                - dataFields が空オブジェクト ({}): プラグインが「data 不要」を明示 → 何もしない案内
                - dataFields に1つでもキーがある: 既に declaredKeys が表示されているのでこのメッセージは出ない
            */}
            {declaredKeys.length === 0 && customKeys.length === 0 && (
                <div className={css({ fontSize: '12px', color: 'textSubtle' })}>
                    {dataFields === undefined
                        ? 'プラグインが data フィールドを宣言していません。下から自由にキーを追加できます（プラグインが読まない可能性があります）。'
                        : 'このエンティティはデータを必要としません。'}
                </div>
            )}

            {/* dataFields が宣言されている (空でも) 場合は、プラグインが想定するフィールド以外は無効なので
                カスタム追加 UI を出さない。dataFields が undefined なら自由追加を許す。 */}
            {dataFields === undefined && (
                <AddFieldRow existing={new Set(Object.keys(data))} onAdd={(k, v) => onChange({ ...data, [k]: v })} />
            )}
        </div>
    );
}

// ============================================
// 宣言フィールド: 型に応じた input
// ============================================

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
    // json
    return <MiniJsonEditor value={value} onChange={onChange} />;
}

// ============================================
// カスタムフィールド (dataFields 宣言外)
// ============================================

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

// ============================================
// JSON ミニエディタ (object/array 用)
// ============================================

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

// ============================================
// + フィールド追加 (任意キーをカスタム追加)
// ============================================

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

// ============================================
// JSON 直接編集タブ
// ============================================

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
// Transform 共通: NumField / Section / MiniTab
// ============================================

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
    return (
        <label className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
            <span className={css({ fontSize: '11px', color: 'textMuted' })}>{label}</span>
            <input
                type="number"
                value={value}
                onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
                className={inputStyle}
            />
        </label>
    );
}

function Section({ label, right, children }: { label: string; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            <div
                className={css({
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: 'text',
                })}
            >
                <span>{label}</span>
                {right}
            </div>
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

// ============================================
// helpers
// ============================================

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
