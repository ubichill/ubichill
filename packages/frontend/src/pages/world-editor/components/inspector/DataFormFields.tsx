import { useEffect, useMemo, useState } from 'react';
import { css } from '@/styled-system/css';
import type { DataFieldSpec, DataFields } from '../../hooks/useAvailableEntityKinds';
import { ColorInput, NumberInput } from './primitives';
import { defaultForType, detectType, inputStyle, textareaStyle } from './shared';

interface DataFormFieldsProps {
    data: Record<string, unknown>;
    dataFields?: DataFields;
    onChange: (next: Record<string, unknown>) => void;
}

/**
 * Component の `data` を編集する「フォーム」タブ。
 * - dataFields が mod から宣言されていればその spec で typed input
 * - 宣言外のキーは「カスタム」セクションに分けて表示
 * - dataFields 未宣言のコンポーネントは自由にキー追加できる
 */
export function DataFormFields({ data, dataFields, onChange }: DataFormFieldsProps) {
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
                    {dataFields !== undefined ? (
                        // 既知コンポーネント: 宣言に無いキー = このコンポーネントは使わない（削除推奨）
                        <span className={css({ fontSize: '11px', color: 'warning', fontWeight: '600' })}>
                            このコンポーネントが使わない data（削除推奨）
                        </span>
                    ) : (
                        declaredKeys.length > 0 && (
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
                        )
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
                        ? 'modが data フィールドを宣言していません。下から自由にキーを追加できます（modが読まない可能性があります）。'
                        : 'このコンポーネントはデータを必要としません。'}
                </div>
            )}

            {dataFields === undefined && (
                <AddFieldRow existing={new Set(Object.keys(data))} onAdd={(k, v) => onChange({ ...data, [k]: v })} />
            )}
        </div>
    );
}

// ============================================
// 宣言済みフィールド: spec.type に応じた typed input
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
            <DeclaredInput spec={spec} value={value} onChange={onChange} name={fieldKey} />
            {spec.help && <span className={css({ fontSize: '10px', color: 'textSubtle' })}>{spec.help}</span>}
        </div>
    );
}

function DeclaredInput({
    spec,
    value,
    onChange,
    name,
}: {
    spec: DataFieldSpec;
    value: unknown;
    onChange: (v: unknown) => void;
    name?: string;
}) {
    if (spec.type === 'string') {
        const s = String(value ?? '');
        if (spec.multiline) {
            return (
                <textarea
                    name={name}
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
                name={name}
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
                name={name}
                value={String(value ?? '')}
                onChange={(e) => onChange(e.target.value)}
                placeholder={spec.placeholder ?? 'https://...'}
                className={inputStyle}
            />
        );
    }
    if (spec.type === 'number') {
        return (
            <NumberInput
                value={typeof value === 'number' ? value : 0}
                min={spec.min}
                max={spec.max}
                step={spec.step ?? 1}
                onChange={onChange}
                className={inputStyle}
                name={name}
            />
        );
    }
    if (spec.type === 'boolean') {
        const v = Boolean(value);
        return (
            <label className={css({ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px' })}>
                <input type="checkbox" name={name} checked={v} onChange={(e) => onChange(e.target.checked)} />
                <span className={css({ color: 'textMuted' })}>{v ? 'true' : 'false'}</span>
            </label>
        );
    }
    if (spec.type === 'color') {
        return <ColorInput value={value} onChange={onChange} name={name} />;
    }
    if (spec.type === 'enum') {
        return (
            <select
                name={name}
                value={String(value ?? '')}
                onChange={(e) => onChange(e.target.value)}
                className={inputStyle}
            >
                {spec.options.map((o) => (
                    <option key={o} value={o}>
                        {o}
                    </option>
                ))}
            </select>
        );
    }
    if (spec.type === 'array') {
        return <ArrayField spec={spec} value={value} onChange={onChange} name={name} />;
    }
    return <MiniJsonEditor value={value} onChange={onChange} name={name} />;
}

// ============================================
// 配列フィールド: item スキーマで各要素を編集 + 行の追加/削除
// ============================================

type ArraySpec = Extract<DataFieldSpec, { type: 'array' }>;

function ArrayField({
    spec,
    value,
    onChange,
    name,
}: {
    spec: ArraySpec;
    value: unknown;
    onChange: (v: unknown) => void;
    name?: string;
}) {
    const items = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
    const itemEntries = Object.entries(spec.item);

    const makeNewItem = (): Record<string, unknown> => {
        const obj: Record<string, unknown> = {};
        for (const [k, s] of itemEntries) obj[k] = s.default ?? defaultForType(s);
        return obj;
    };
    const replace = (next: Record<string, unknown>[]) => onChange(next);
    const updateItem = (i: number, next: Record<string, unknown>) =>
        replace(items.map((it, idx) => (idx === i ? next : it)));
    const removeItem = (i: number) => replace(items.filter((_, idx) => idx !== i));
    const moveItem = (i: number, dir: -1 | 1) => {
        const j = i + dir;
        if (j < 0 || j >= items.length) return;
        const copy = items.slice();
        [copy[i], copy[j]] = [copy[j], copy[i]];
        replace(copy);
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '6px' })}>
            {items.map((item, i) => (
                <div
                    key={i}
                    className={css({
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        padding: '8px',
                        borderRadius: '8px',
                        border: '1px solid',
                        borderColor: 'border',
                        bg: 'backgroundSubtle',
                    })}
                >
                    <div className={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
                        <span className={css({ fontSize: '11px', color: 'textSubtle', fontWeight: '600' })}>
                            #{i + 1}
                        </span>
                        <div className={css({ display: 'flex', gap: '4px' })}>
                            <ArrayRowBtn label="↑" title="上へ" onClick={() => moveItem(i, -1)} disabled={i === 0} />
                            <ArrayRowBtn
                                label="↓"
                                title="下へ"
                                onClick={() => moveItem(i, 1)}
                                disabled={i === items.length - 1}
                            />
                            <ArrayRowBtn label="×" title="削除" danger onClick={() => removeItem(i)} />
                        </div>
                    </div>
                    {itemEntries.map(([k, s]) => (
                        <div key={k} className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
                            <span className={css({ fontSize: '11px', color: 'textMuted' })}>{s.label ?? k}</span>
                            <DeclaredInput
                                spec={s}
                                value={k in item ? item[k] : (s.default ?? defaultForType(s))}
                                onChange={(v) => updateItem(i, { ...item, [k]: v })}
                                name={`${name ?? 'item'}-${i}-${k}`}
                            />
                        </div>
                    ))}
                </div>
            ))}
            <button
                type="button"
                onClick={() => replace([...items, makeNewItem()])}
                className={css({
                    padding: '6px 10px',
                    bg: 'transparent',
                    color: 'primary',
                    border: '1px dashed',
                    borderColor: 'primary',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    _hover: { bg: 'primarySubtle' },
                })}
            >
                ＋ 追加
            </button>
        </div>
    );
}

function ArrayRowBtn({
    label,
    title,
    onClick,
    disabled,
    danger,
}: {
    label: string;
    title: string;
    onClick: () => void;
    disabled?: boolean;
    danger?: boolean;
}) {
    return (
        <button
            type="button"
            title={title}
            onClick={onClick}
            disabled={disabled}
            className={css({
                padding: '2px 7px',
                bg: 'transparent',
                color: danger ? 'errorText' : 'textMuted',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '5px',
                fontSize: '11px',
                cursor: 'pointer',
                opacity: disabled ? 0.4 : 1,
                _hover: { borderColor: danger ? 'errorLight' : 'primary' },
                _disabled: { cursor: 'not-allowed' },
            })}
        >
            {label}
        </button>
    );
}

// ============================================
// カスタムフィールド: 値の型から推測した input + 削除ボタン
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
                    <input
                        type="checkbox"
                        name={fieldKey}
                        checked={Boolean(value)}
                        onChange={(e) => onChange(e.target.checked)}
                    />
                    <span className={css({ color: 'textMuted' })}>{value ? 'true' : 'false'}</span>
                </label>
            ) : type === 'number' ? (
                <NumberInput value={Number(value)} onChange={onChange} className={inputStyle} name={fieldKey} />
            ) : type === 'color' ? (
                <ColorInput value={value} onChange={onChange} name={fieldKey} />
            ) : type === 'string' ? (
                <input
                    type="text"
                    name={fieldKey}
                    value={String(value)}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputStyle}
                />
            ) : (
                <MiniJsonEditor value={value} onChange={onChange} name={fieldKey} />
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
// 小型 JSON エディタ (object/array 値用)
// ============================================

function MiniJsonEditor({ value, onChange, name }: { value: unknown; onChange: (v: unknown) => void; name?: string }) {
    const [text, setText] = useState(() => JSON.stringify(value, null, 2));
    const [err, setErr] = useState('');
    useEffect(() => {
        setText(JSON.stringify(value, null, 2));
        setErr('');
    }, [value]);
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
            <textarea
                name={name}
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
// カスタムフィールド追加行
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
                name="new-field-name"
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
            <select
                name="new-field-type"
                value={type}
                onChange={(e) => setType(e.target.value as typeof type)}
                className={inputStyle}
            >
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
