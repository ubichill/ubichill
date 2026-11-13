import type { WorldDefinition } from '@ubichill/shared';
import { useState } from 'react';
import { toWorldName, WORLD_NAME_MAX_LENGTH } from '@/lib/worlds/worldName';
import { css } from '@/styled-system/css';

interface WorldInfoFormProps {
    /** 編集中の definition。親 (WorldEditorPage) が状態を持ち、ここでは直接更新する。 */
    definition: WorldDefinition;
    onChange: (next: WorldDefinition) => void;
}

/**
 * コントロールパネルの「ワールド情報」タブの中身。
 * displayName / 名前（URL）/ description / thumbnail / capacity / worldSize / 背景色。版は公開のたびに自動で上がるので出さない。
 *
 * 編集は親の definition を直接更新する（即時反映・ローカル）。サーバーへの保存は
 * 「閉じる」「Cmd/Ctrl+S」で行う。公開設定・mod 管理はそれぞれ別タブの責務。
 */
export function WorldInfoForm({ definition, onChange }: WorldInfoFormProps) {
    const onUpdateSpec = (patch: Partial<WorldDefinition['spec']>) =>
        onChange({ ...definition, spec: { ...definition.spec, ...patch } });
    const onUpdateMetadata = (patch: Partial<WorldDefinition['metadata']>) =>
        onChange({ ...definition, metadata: { ...definition.metadata, ...patch } });
    const spec = definition.spec;
    const env = spec.environment ?? {
        backgroundColor: '#F0F8FF',
        worldSize: { width: 2000, height: 1500 },
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '5' })}>
            <div
                className={css({
                    display: 'grid',
                    gridTemplateColumns: { base: '1fr', md: 'minmax(0, 1fr) 280px' },
                    gap: '5',
                    alignItems: 'start',
                })}
            >
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                    <Field label="表示名（日本語可）" required>
                        <input
                            type="text"
                            name="world-displayName"
                            value={spec.displayName}
                            onChange={(e) => onUpdateSpec({ displayName: e.target.value })}
                            maxLength={1000}
                            placeholder="例: ぼくのワールド"
                            className={inputStyle}
                        />
                    </Field>
                    <Field label="名前（URL）" required>
                        <div className={css({ display: 'flex', alignItems: 'center', gap: '6px' })}>
                            <span className={css({ fontSize: '13px', color: 'textMuted', whiteSpace: 'nowrap' })}>
                                /@ID/
                            </span>
                            <input
                                type="text"
                                name="world-name"
                                value={definition.metadata.name}
                                onChange={(e) => onUpdateMetadata({ name: toWorldName(e.target.value) })}
                                maxLength={WORLD_NAME_MAX_LENGTH}
                                autoCapitalize="none"
                                spellCheck={false}
                                className={inputStyle}
                            />
                        </div>
                        <span className={css({ fontSize: '12px', color: 'textMuted', lineHeight: '1.5' })}>
                            英小文字・数字・- で 50 文字まで。変えると URL が変わります（以前の URL からも開けます）
                        </span>
                    </Field>
                    <Field label="説明">
                        <textarea
                            name="world-description"
                            value={spec.description ?? ''}
                            onChange={(e) => onUpdateSpec({ description: e.target.value || undefined })}
                            maxLength={1000}
                            rows={3}
                            placeholder="このワールドについての説明"
                            className={inputStyle}
                        />
                    </Field>
                </div>
                <ThumbnailPicker url={spec.thumbnail} onChange={(thumbnail) => onUpdateSpec({ thumbnail })} />
            </div>

            <div className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}>
                <div className={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4' })}>
                    <Field label="標準キャパシティ">
                        <input
                            type="number"
                            min={1}
                            name="world-capacity-default"
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
                            name="world-capacity-max"
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
                            name="world-size-width"
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
                            name="world-size-height"
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
                            name="world-bgColor-picker"
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
                            name="world-bgColor"
                            value={env.backgroundColor ?? '#F0F8FF'}
                            onChange={(e) => onUpdateSpec({ environment: { ...env, backgroundColor: e.target.value } })}
                            pattern="^#[0-9A-Fa-f]{6}$"
                            className={inputStyle}
                        />
                    </div>
                </Field>
            </div>
        </div>
    );
}

const inputStyle = css({
    width: '100%',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid',
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

/** 右上のサムネイル。画像を押すと URL を入れ替えられる（空にすると外れる）。 */
function ThumbnailPicker({ url, onChange }: { url: string | undefined; onChange: (url: string | undefined) => void }) {
    const [editing, setEditing] = useState(false);
    const [failedUrl, setFailedUrl] = useState<string | null>(null);
    const showImage = !!url && failedUrl !== url;
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
            <button
                type="button"
                onClick={() => setEditing(true)}
                title="サムネイルを変更"
                aria-label="サムネイルを変更"
                className={css({
                    aspectRatio: '16 / 9',
                    width: '100%',
                    padding: 0,
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: editing ? 'primary' : 'border',
                    bg: 'surface',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2',
                    color: 'textSubtle',
                    fontSize: '12px',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                    _hover: { borderColor: 'primary' },
                })}
            >
                {showImage ? (
                    <img
                        src={url}
                        alt=""
                        onError={() => setFailedUrl(url)}
                        className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                    />
                ) : (
                    <>
                        <ImageIcon />
                        {url ? '画像を読み込めません' : 'サムネイル'}
                    </>
                )}
            </button>
            {editing && (
                <input
                    type="url"
                    name="world-thumbnail"
                    // biome-ignore lint/a11y/noAutofocus: 画像を押した直後に入力するため
                    autoFocus
                    defaultValue={url ?? ''}
                    placeholder="https://..."
                    onBlur={(e) => {
                        onChange(e.target.value.trim() || undefined);
                        setEditing(false);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') setEditing(false);
                    }}
                    className={inputStyle}
                />
            )}
        </div>
    );
}

function ImageIcon() {
    return (
        <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
        >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="2" />
            <path d="M21 16l-5-5-9 9" />
        </svg>
    );
}
