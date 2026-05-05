import type { WorldDefinition } from '@ubichill/shared';
import { css } from '@/styled-system/css';
import { PluginSelector } from './PluginSelector';

interface WorldInfoFormProps {
    definition: WorldDefinition;
    onUpdateSpec: (patch: Partial<WorldDefinition['spec']>) => void;
    onUpdateMetadata: (patch: Partial<WorldDefinition['metadata']>) => void;
}

/**
 * ワールド情報モーダルの中身。
 * displayName / description / thumbnail / version / capacity / worldSize / 背景色 / 使用プラグイン。
 */
export function WorldInfoForm({ definition, onUpdateSpec, onUpdateMetadata }: WorldInfoFormProps) {
    const spec = definition.spec;
    const env = spec.environment ?? {
        backgroundColor: '#F0F8FF',
        worldSize: { width: 2000, height: 1500 },
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
            <Field label="表示名（日本語可）" required>
                <input
                    type="text"
                    value={spec.displayName}
                    onChange={(e) => onUpdateSpec({ displayName: e.target.value })}
                    maxLength={1000}
                    placeholder="例: ぼくのワールド"
                    className={inputStyle}
                />
            </Field>
            <Field label="説明">
                <textarea
                    value={spec.description ?? ''}
                    onChange={(e) => onUpdateSpec({ description: e.target.value || undefined })}
                    maxLength={1000}
                    rows={3}
                    placeholder="このワールドについての説明"
                    className={inputStyle}
                />
            </Field>
            <Field label="サムネイル URL">
                <input
                    type="url"
                    value={spec.thumbnail ?? ''}
                    onChange={(e) => onUpdateSpec({ thumbnail: e.target.value || undefined })}
                    placeholder="https://..."
                    className={inputStyle}
                />
            </Field>
            <Field label="バージョン">
                <input
                    type="text"
                    value={definition.metadata.version}
                    onChange={(e) => onUpdateMetadata({ version: e.target.value })}
                    placeholder="1.0.0"
                    className={inputStyle}
                />
            </Field>
            <div className={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4' })}>
                <Field label="標準キャパシティ">
                    <input
                        type="number"
                        min={1}
                        value={spec.capacity.default}
                        onChange={(e) =>
                            onUpdateSpec({
                                capacity: {
                                    ...spec.capacity,
                                    default: Number.parseInt(e.target.value, 10) || 1,
                                },
                            })
                        }
                        className={inputStyle}
                    />
                </Field>
                <Field label="最大キャパシティ">
                    <input
                        type="number"
                        min={1}
                        value={spec.capacity.max}
                        onChange={(e) =>
                            onUpdateSpec({
                                capacity: {
                                    ...spec.capacity,
                                    max: Number.parseInt(e.target.value, 10) || 1,
                                },
                            })
                        }
                        className={inputStyle}
                    />
                </Field>
            </div>
            <div className={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4' })}>
                <Field label="ワールド幅">
                    <input
                        type="number"
                        min={100}
                        value={env.worldSize?.width ?? 2000}
                        onChange={(e) =>
                            onUpdateSpec({
                                environment: {
                                    ...env,
                                    worldSize: {
                                        ...(env.worldSize ?? { width: 2000, height: 1500 }),
                                        width: Number.parseInt(e.target.value, 10) || 100,
                                    },
                                },
                            })
                        }
                        className={inputStyle}
                    />
                </Field>
                <Field label="ワールド高さ">
                    <input
                        type="number"
                        min={100}
                        value={env.worldSize?.height ?? 1500}
                        onChange={(e) =>
                            onUpdateSpec({
                                environment: {
                                    ...env,
                                    worldSize: {
                                        ...(env.worldSize ?? { width: 2000, height: 1500 }),
                                        height: Number.parseInt(e.target.value, 10) || 100,
                                    },
                                },
                            })
                        }
                        className={inputStyle}
                    />
                </Field>
            </div>
            <Field label="背景色">
                <div className={css({ display: 'flex', gap: '8px', alignItems: 'center' })}>
                    <input
                        type="color"
                        value={env.backgroundColor ?? '#F0F8FF'}
                        onChange={(e) =>
                            onUpdateSpec({
                                environment: { ...env, backgroundColor: e.target.value.toUpperCase() },
                            })
                        }
                        className={css({
                            width: '48px',
                            height: '36px',
                            borderRadius: '8px',
                            border: '1px solid',
                            borderColor: 'border',
                            cursor: 'pointer',
                        })}
                    />
                    <input
                        type="text"
                        value={env.backgroundColor ?? '#F0F8FF'}
                        onChange={(e) => onUpdateSpec({ environment: { ...env, backgroundColor: e.target.value } })}
                        pattern="^#[0-9A-Fa-f]{6}$"
                        className={inputStyle}
                    />
                </div>
            </Field>

            <PluginSelector definition={definition} onUpdateSpec={onUpdateSpec} />
        </div>
    );
}

const inputStyle = css({
    width: '100%',
    padding: '9px 12px',
    borderRadius: '10px',
    border: '1.5px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
    fontSize: '14px',
    outline: 'none',
    _focus: { borderColor: 'primary' },
    _placeholder: { color: 'textSubtle' },
});

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '6px' })}>
            <span className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                {label}
                {required && <span className={css({ color: 'errorText', ml: '4px' })}>*</span>}
            </span>
            {children}
        </div>
    );
}
