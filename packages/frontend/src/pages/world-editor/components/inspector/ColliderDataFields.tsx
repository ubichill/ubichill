import { type ColliderData, createDefaultColliderData } from '@ubichill/core-components';
import { useId } from 'react';
import { css } from '@/styled-system/css';
import { normalizeColliderForEditor } from './colliderEditorData';
import { NumberInput } from './primitives';
import { inputStyle } from './shared';

interface ColliderDataFieldsProps {
    data: Record<string, unknown>;
    onChange: (next: Record<string, unknown>) => void;
}

const fieldLabel = css({ display: 'flex', flexDirection: 'column', gap: '1', fontSize: '11px', color: 'textMuted' });

export function ColliderDataFields({ data, onChange }: ColliderDataFieldsProps) {
    const formId = useId();
    const collider = normalizeColliderForEditor(data);
    const setCommon = (patch: Partial<Pick<ColliderData, 'offset' | 'isTrigger' | 'layer' | 'mask'>>) =>
        onChange({ ...collider, ...patch });

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <label className={fieldLabel}>
                形状
                <select
                    name="collider-shape"
                    value={collider.shape}
                    onChange={(e) => {
                        const next = createDefaultColliderData(e.target.value === 'circle' ? 'circle' : 'rect');
                        onChange({
                            ...next,
                            offset: collider.offset,
                            isTrigger: collider.isTrigger,
                            layer: collider.layer,
                            mask: collider.mask,
                        });
                    }}
                    className={inputStyle}
                >
                    <option value="rect">矩形</option>
                    <option value="circle">円</option>
                </select>
            </label>

            {collider.shape === 'rect' ? (
                <>
                    <label className={css({ display: 'flex', alignItems: 'center', gap: '2', fontSize: '12px' })}>
                        <input
                            type="checkbox"
                            name="collider-use-entity-size"
                            checked={collider.size === 'entity'}
                            onChange={(e) =>
                                onChange({ ...collider, size: e.target.checked ? 'entity' : { w: 100, h: 100 } })
                            }
                        />
                        EntityのW/Hを当たり判定にも使う
                    </label>
                    {collider.size !== 'entity' && (
                        <div className={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2' })}>
                            <label htmlFor={`${formId}-width`} className={fieldLabel}>
                                幅
                                <NumberInput
                                    name="collider-width"
                                    id={`${formId}-width`}
                                    value={collider.size.w}
                                    min={1}
                                    onChange={(w) => {
                                        const size = collider.size === 'entity' ? { w: 100, h: 100 } : collider.size;
                                        onChange({ ...collider, size: { ...size, w } });
                                    }}
                                    className={inputStyle}
                                />
                            </label>
                            <label htmlFor={`${formId}-height`} className={fieldLabel}>
                                高さ
                                <NumberInput
                                    name="collider-height"
                                    id={`${formId}-height`}
                                    value={collider.size.h}
                                    min={1}
                                    onChange={(h) => {
                                        const size = collider.size === 'entity' ? { w: 100, h: 100 } : collider.size;
                                        onChange({ ...collider, size: { ...size, h } });
                                    }}
                                    className={inputStyle}
                                />
                            </label>
                        </div>
                    )}
                </>
            ) : (
                <label htmlFor={`${formId}-radius`} className={fieldLabel}>
                    半径
                    <NumberInput
                        name="collider-radius"
                        id={`${formId}-radius`}
                        value={collider.radius}
                        min={1}
                        onChange={(radius) => onChange({ ...collider, radius })}
                        className={inputStyle}
                    />
                </label>
            )}

            <div className={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2' })}>
                <label htmlFor={`${formId}-offset-x`} className={fieldLabel}>
                    オフセット X
                    <NumberInput
                        name="collider-offset-x"
                        id={`${formId}-offset-x`}
                        value={collider.offset.x}
                        onChange={(x) => setCommon({ offset: { ...collider.offset, x } })}
                        className={inputStyle}
                    />
                </label>
                <label htmlFor={`${formId}-offset-y`} className={fieldLabel}>
                    オフセット Y
                    <NumberInput
                        name="collider-offset-y"
                        id={`${formId}-offset-y`}
                        value={collider.offset.y}
                        onChange={(y) => setCommon({ offset: { ...collider.offset, y } })}
                        className={inputStyle}
                    />
                </label>
            </div>

            <label className={css({ display: 'flex', alignItems: 'center', gap: '2', fontSize: '12px' })}>
                <input
                    type="checkbox"
                    name="collider-trigger"
                    checked={collider.isTrigger}
                    onChange={(e) => setCommon({ isTrigger: e.target.checked })}
                />
                Trigger（接触検知のみ）
            </label>

            <label className={fieldLabel}>
                Layer
                <input
                    type="text"
                    name="collider-layer"
                    value={collider.layer}
                    onChange={(e) => setCommon({ layer: e.target.value })}
                    className={inputStyle}
                />
            </label>
            <label className={fieldLabel}>
                Mask（カンマ区切り）
                <input
                    type="text"
                    name="collider-mask"
                    value={collider.mask.join(', ')}
                    onChange={(e) =>
                        setCommon({
                            mask: e.target.value
                                .split(',')
                                .map((item) => item.trim())
                                .filter(Boolean),
                        })
                    }
                    className={inputStyle}
                />
            </label>
        </div>
    );
}
