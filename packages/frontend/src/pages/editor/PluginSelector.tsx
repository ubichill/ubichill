import type { WorldDefinition } from '@ubichill/shared';
import { useCallback, useEffect, useState } from 'react';
import { css } from '@/styled-system/css';
import { type AvailablePlugin, pluginToDependency, useAvailablePlugins } from './useAvailablePlugins';

const REGISTRY_URLS_STORAGE_KEY = 'world-editor:registry-urls';

function loadStoredRegistryUrls(): string[] {
    try {
        const raw = localStorage.getItem(REGISTRY_URLS_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((v): v is string => typeof v === 'string');
    } catch {
        return [];
    }
}

function saveStoredRegistryUrls(urls: string[]) {
    try {
        localStorage.setItem(REGISTRY_URLS_STORAGE_KEY, JSON.stringify(urls));
    } catch {
        /* localStorage 失敗時は無視 */
    }
}

interface PluginSelectorProps {
    definition: WorldDefinition;
    onUpdateSpec: (patch: Partial<WorldDefinition['spec']>) => void;
}

/**
 * フォームタブ内で使う「使用するプラグイン」セクション。
 * - ローカル + ユーザー追加レジストリから利用可能プラグイン一覧を取得
 * - チェックボックスで dependencies に add/remove
 * - レジストリ URL を追加できる（localStorage に保存）
 */
export function PluginSelector({ definition, onUpdateSpec }: PluginSelectorProps) {
    const [registryUrls, setRegistryUrls] = useState<string[]>(() => loadStoredRegistryUrls());
    const [registryInput, setRegistryInput] = useState('');
    const [registryError, setRegistryError] = useState('');

    const { plugins, loading } = useAvailablePlugins(registryUrls);

    useEffect(() => {
        saveStoredRegistryUrls(registryUrls);
    }, [registryUrls]);

    const dependencies = definition.spec.dependencies ?? [];
    const checkedNames = new Set(dependencies.map((d) => d.name));

    const handleToggle = useCallback(
        (p: AvailablePlugin) => {
            if (checkedNames.has(p.id)) {
                onUpdateSpec({ dependencies: dependencies.filter((d) => d.name !== p.id) });
            } else {
                onUpdateSpec({ dependencies: [...dependencies, pluginToDependency(p)] });
            }
        },
        [checkedNames, dependencies, onUpdateSpec],
    );

    const handleAddRegistry = useCallback(() => {
        const trimmed = registryInput.trim();
        if (!trimmed) return;
        try {
            new URL(trimmed);
        } catch {
            setRegistryError('URL の形式が不正です');
            return;
        }
        if (registryUrls.includes(trimmed)) {
            setRegistryError('既に追加されています');
            return;
        }
        setRegistryUrls((prev) => [...prev, trimmed]);
        setRegistryInput('');
        setRegistryError('');
    }, [registryInput, registryUrls]);

    const handleRemoveRegistry = useCallback((url: string) => {
        setRegistryUrls((prev) => prev.filter((u) => u !== url));
    }, []);

    // 既に依存にあるが、利用可能リストに無い（未知のプラグイン）も表示する
    const knownIds = new Set(plugins.map((p) => p.id));
    const unknownDeps = dependencies.filter((d) => !knownIds.has(d.name));

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <span className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                使用するプラグイン
                {loading && (
                    <span className={css({ ml: '2', color: 'textSubtle', fontWeight: '400' })}>(読み込み中...)</span>
                )}
            </span>

            {/* プラグイン一覧（チェックボックス） */}
            <div
                className={css({
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: '8px',
                })}
            >
                {plugins.map((p) => {
                    const checked = checkedNames.has(p.id);
                    return (
                        <button
                            type="button"
                            key={`${p.sourceLabel}:${p.id}`}
                            onClick={() => handleToggle(p)}
                            className={css({
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                p: '10px 12px',
                                bg: checked ? 'primarySubtle' : 'background',
                                border: '1.5px solid',
                                borderColor: checked ? 'primary' : 'border',
                                borderRadius: '10px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                _hover: { borderColor: 'borderStrong' },
                            })}
                        >
                            <span
                                className={css({
                                    flexShrink: 0,
                                    width: '16px',
                                    height: '16px',
                                    borderRadius: '4px',
                                    border: '2px solid',
                                    borderColor: checked ? 'primary' : 'border',
                                    bg: checked ? 'primary' : 'transparent',
                                    color: 'textOnPrimary',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    mt: '2px',
                                })}
                            >
                                {checked && (
                                    <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 12 12"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <path d="M2 6l3 3 5-6" />
                                    </svg>
                                )}
                            </span>
                            <div className={css({ flex: 1, minWidth: 0 })}>
                                <div
                                    className={css({
                                        fontSize: '14px',
                                        fontWeight: '600',
                                        color: 'text',
                                    })}
                                >
                                    {p.name}
                                </div>
                                <div className={css({ fontSize: '11px', color: 'textSubtle', mt: '2px' })}>
                                    v{p.version} · {p.kinds.length} kinds
                                </div>
                                <div
                                    className={css({
                                        fontSize: '10px',
                                        color: 'textSubtle',
                                        mt: '2px',
                                        opacity: 0.8,
                                    })}
                                >
                                    {p.sourceLabel === 'local' ? 'ローカル' : p.sourceLabel}
                                </div>
                            </div>
                        </button>
                    );
                })}
                {!loading && plugins.length === 0 && (
                    <div className={css({ fontSize: '13px', color: 'textMuted', p: '12px' })}>
                        利用可能なプラグインが見つかりません
                    </div>
                )}
            </div>

            {/* 未知のプラグイン（YAML で直接追加されたもの） */}
            {unknownDeps.length > 0 && (
                <div
                    className={css({
                        bg: 'background',
                        border: '1px dashed',
                        borderColor: 'border',
                        borderRadius: '10px',
                        p: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                    })}
                >
                    <span className={css({ fontSize: '11px', color: 'textSubtle', fontWeight: '600' })}>
                        その他の依存（未知のプラグイン）
                    </span>
                    {unknownDeps.map((d) => (
                        <div
                            key={d.name}
                            className={css({
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                fontSize: '13px',
                                color: 'text',
                            })}
                        >
                            <span>{d.name}</span>
                            <button
                                type="button"
                                onClick={() =>
                                    onUpdateSpec({ dependencies: dependencies.filter((x) => x.name !== d.name) })
                                }
                                className={css({
                                    fontSize: '11px',
                                    color: 'errorText',
                                    bg: 'transparent',
                                    border: 'none',
                                    cursor: 'pointer',
                                })}
                            >
                                削除
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* レジストリ URL の追加 */}
            <div
                className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    bg: 'background',
                    borderRadius: '10px',
                    p: '10px 12px',
                    border: '1px solid',
                    borderColor: 'border',
                })}
            >
                <span className={css({ fontSize: '12px', color: 'textMuted', fontWeight: '600' })}>
                    レジストリ URL を追加（外部プラグイン）
                </span>
                <div className={css({ display: 'flex', gap: '6px' })}>
                    <input
                        type="url"
                        value={registryInput}
                        onChange={(e) => {
                            setRegistryInput(e.target.value);
                            setRegistryError('');
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddRegistry();
                            }
                        }}
                        placeholder="https://example.com/plugins/index.json"
                        className={css({
                            flex: 1,
                            padding: '6px 10px',
                            borderRadius: '8px',
                            border: '1.5px solid',
                            borderColor: registryError ? 'errorText' : 'border',
                            bg: 'surface',
                            color: 'text',
                            fontSize: '12px',
                            outline: 'none',
                            _focus: { borderColor: 'primary' },
                        })}
                    />
                    <button
                        type="button"
                        onClick={handleAddRegistry}
                        disabled={!registryInput.trim()}
                        className={css({
                            padding: '6px 14px',
                            bg: 'primary',
                            color: 'textOnPrimary',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                            _hover: { opacity: 0.9 },
                        })}
                    >
                        追加
                    </button>
                </div>
                {registryError && (
                    <span className={css({ fontSize: '11px', color: 'errorText' })}>{registryError}</span>
                )}
                {registryUrls.length > 0 && (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '4px', mt: '2px' })}>
                        {registryUrls.map((u) => (
                            <div
                                key={u}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    fontSize: '12px',
                                    color: 'textMuted',
                                    gap: '6px',
                                })}
                            >
                                <span
                                    className={css({
                                        flex: 1,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    })}
                                >
                                    {u}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => handleRemoveRegistry(u)}
                                    className={css({
                                        fontSize: '11px',
                                        color: 'errorText',
                                        bg: 'transparent',
                                        border: 'none',
                                        cursor: 'pointer',
                                    })}
                                >
                                    削除
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
