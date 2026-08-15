import type { WorldDefinition } from '@ubichill/shared';
import { useCallback } from 'react';
import { type AvailableMod, modToDependency, useAvailableMods } from '@/lib/mods/useAvailableMods';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css } from '@/styled-system/css';
import { PanelSection } from '../PanelSection';
import { RegistryUrlManager } from './RegistryUrlManager';

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string');

interface ModSelectorProps {
    definition: WorldDefinition;
    onUpdateSpec: (patch: Partial<WorldDefinition['spec']>) => void;
}

/**
 * フォームタブ内で使う「使用するmod」セクション。
 * - ローカル + ユーザー追加レジストリから利用可能mod一覧を取得
 * - チェックボックスで dependencies に add/remove
 * - レジストリ URL の追加/削除/エクスポート/インポート（RegistryUrlManager）
 */
export function ModSelector({ definition, onUpdateSpec }: ModSelectorProps) {
    const [registryUrls, setRegistryUrls] = useSetting<string[]>(SETTINGS_KEYS.editorRegistryUrls, [], isStringArray);

    const { mods, loading } = useAvailableMods(registryUrls);

    const dependencies = definition.spec.dependencies ?? [];
    const checkedNames = new Set(dependencies.map((d) => d.name));

    const handleToggle = useCallback(
        (p: AvailableMod) => {
            if (checkedNames.has(p.id)) {
                onUpdateSpec({ dependencies: dependencies.filter((d) => d.name !== p.id) });
            } else {
                onUpdateSpec({ dependencies: [...dependencies, modToDependency(p)] });
            }
        },
        [checkedNames, dependencies, onUpdateSpec],
    );

    const handleVersionChange = useCallback(
        (p: AvailableMod, version: string) => {
            onUpdateSpec({
                dependencies: dependencies.map((d) => (d.name === p.id ? modToDependency(p, version) : d)),
            });
        },
        [dependencies, onUpdateSpec],
    );

    // 既に依存にあるが、利用可能リストに無い（未知のmod）も表示する
    const knownIds = new Set(mods.map((p) => p.id));
    const unknownDeps = dependencies.filter((d) => !knownIds.has(d.name));

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <PanelSection title={loading ? '使用するmod (読み込み中...)' : '使用するmod'}>
                {/* mod一覧（チェックボックス） */}
                <div
                    className={css({
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: '8px',
                    })}
                >
                    {mods.map((p) => {
                        const checked = checkedNames.has(p.id);
                        const dep = dependencies.find((d) => d.name === p.id);
                        // 'latest'（既定・常に最新を追う）か、pin された具体的なバージョンかのどちらか。
                        const pinnedVersion = dep?.source.version ?? 'latest';
                        const isOutdated = pinnedVersion !== 'latest' && pinnedVersion !== p.version;
                        return (
                            <div
                                key={`${p.sourceLabel}:${p.id}`}
                                className={css({
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                    p: '10px 12px',
                                    bg: checked ? 'primarySubtle' : 'background',
                                    border: '1.5px solid',
                                    borderColor: checked ? 'primary' : 'border',
                                    borderRadius: '10px',
                                    _hover: { borderColor: 'borderStrong' },
                                })}
                            >
                                <button
                                    type="button"
                                    onClick={() => handleToggle(p)}
                                    className={css({
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '8px',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        bg: 'transparent',
                                        border: 'none',
                                        p: '0',
                                        width: '100%',
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
                                            v{p.version} · {p.components.length} components
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

                                {checked && (
                                    <div
                                        className={css({
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            pl: '24px',
                                        })}
                                    >
                                        <select
                                            aria-label={`バージョン (${p.name})`}
                                            value={pinnedVersion}
                                            onChange={(e) => handleVersionChange(p, e.target.value)}
                                            className={css({
                                                fontSize: '11px',
                                                p: '2px 6px',
                                                borderRadius: '6px',
                                                border: '1px solid',
                                                borderColor: 'border',
                                                bg: 'background',
                                                color: 'text',
                                            })}
                                        >
                                            <option value="latest">latest（自動追従）</option>
                                            {(p.versions ?? []).map((v) => (
                                                <option key={v.version} value={v.version}>
                                                    v{v.version}
                                                </option>
                                            ))}
                                        </select>
                                        {isOutdated && (
                                            <button
                                                type="button"
                                                onClick={() => handleVersionChange(p, p.version)}
                                                className={css({
                                                    fontSize: '11px',
                                                    color: 'primary',
                                                    bg: 'transparent',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    textDecoration: 'underline',
                                                })}
                                            >
                                                最新 (v{p.version}) に更新
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {!loading && mods.length === 0 && (
                        <div className={css({ fontSize: '13px', color: 'textMuted', p: '12px' })}>
                            利用可能なmodが見つかりません
                        </div>
                    )}
                </div>

                {/* 未知のmod（YAML で直接追加されたもの） */}
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
                            その他の依存（未知のmod）
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
            </PanelSection>

            <PanelSection title="レジストリ管理" defaultOpen={false}>
                <RegistryUrlManager registryUrls={registryUrls} onChange={setRegistryUrls} />
            </PanelSection>
        </div>
    );
}
