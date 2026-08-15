import type { Dependency } from '@ubichill/shared';
import { useMemo, useState } from 'react';
import { type AvailableMod, useAvailableMods } from '@/lib/mods/useAvailableMods';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css } from '@/styled-system/css';
import { computeModDiff, type ModSelectionEntry, selectionToDependencies } from '../../lib/modSelection';
import { editorButton } from '../../recipes/button';
import { PanelSection } from '../PanelSection';
import { RegistryUrlManager } from './RegistryUrlManager';

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string');

interface ModSelectorProps {
    /** 現在 definition に登録済みの依存（インストール済み mod）。 */
    dependencies: Dependency[];
    /** インストール確定時に dependencies を置き換える。 */
    onCommitDependencies: (next: Dependency[]) => void;
}

/**
 * 「mod管理」タブ。チェック/バージョン選択はローカルの選択状態に留め、
 * 「インストール」ボタンで初めて definition へ反映する。
 * 反映前に追加/削除/更新の差分と、外部 URL 由来 mod のセキュリティ注記を表示する。
 */
export function ModSelector({ dependencies, onCommitDependencies }: ModSelectorProps) {
    const [registryUrls, setRegistryUrls] = useSetting<string[]>(SETTINGS_KEYS.editorRegistryUrls, [], isStringArray);
    const { mods, loading } = useAvailableMods(registryUrls);

    // 選択状態。タブを開くたびに現在の dependencies から初期化される（staging は保持しない）。
    const [selected, setSelected] = useState<ModSelectionEntry[]>(() =>
        dependencies.map((d) => ({
            id: d.name,
            version: d.source.version,
            baseUrl: d.source.type === 'url' ? d.source.url : undefined,
        })),
    );

    const nextDependencies = useMemo(() => selectionToDependencies(selected), [selected]);
    const diff = useMemo(() => computeModDiff(dependencies, nextDependencies), [dependencies, nextDependencies]);
    const hasDiff = diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0;

    const knownIds = new Set(mods.map((m) => m.id));
    // 読み込み中は mod 一覧が空のため、既存の依存を「未知」と誤判定しない。
    const unknownSelected = loading ? [] : selected.filter((e) => !knownIds.has(e.id));

    const upsertSelected = (entry: ModSelectionEntry) =>
        setSelected((prev) => {
            const exists = prev.some((e) => e.id === entry.id);
            return exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [...prev, entry];
        });
    const removeSelected = (id: string) => setSelected((prev) => prev.filter((e) => e.id !== id));

    const handleToggle = (p: AvailableMod) => {
        const existing = selected.find((e) => e.id === p.id);
        if (existing) removeSelected(p.id);
        else upsertSelected({ id: p.id, version: 'latest', baseUrl: p.baseUrl });
    };

    const handleVersionChange = (p: AvailableMod, version: string) => {
        upsertSelected({ id: p.id, version, baseUrl: p.baseUrl });
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <PanelSection title={loading ? '使用するmod (読み込み中...)' : '使用するmod'}>
                <div
                    className={css({
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: '8px',
                    })}
                >
                    {mods.map((p) => {
                        const selectedEntry = selected.find((e) => e.id === p.id);
                        const checked = !!selectedEntry;
                        const pinnedVersion = selectedEntry?.version ?? 'latest';
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
                                        <SourceLabel mod={p} />
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

                {unknownSelected.length > 0 && (
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
                            mt: '3',
                        })}
                    >
                        <span className={css({ fontSize: '11px', color: 'textSubtle', fontWeight: '600' })}>
                            その他の依存（未知のmod）
                        </span>
                        {unknownSelected.map((e) => (
                            <div
                                key={e.id}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    fontSize: '13px',
                                    color: 'text',
                                })}
                            >
                                <span>{e.id}</span>
                                <button
                                    type="button"
                                    onClick={() => removeSelected(e.id)}
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

            <PanelSection title="インストール差分">
                {hasDiff ? (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        {diff.added.map((d) => (
                            <DiffRow key={`add:${d.name}`} kind="追加" dependency={d} />
                        ))}
                        {diff.removed.map((d) => (
                            <DiffRow key={`remove:${d.name}`} kind="削除" dependency={d} />
                        ))}
                        {diff.updated.map(({ from, to }) => (
                            <DiffRow
                                key={`update:${to.name}`}
                                kind="更新"
                                dependency={to}
                                fromVersion={from.source.version}
                            />
                        ))}
                    </div>
                ) : (
                    <p className={css({ fontSize: '13px', color: 'textMuted' })}>変更はありません</p>
                )}
                <div className={css({ mt: '3', display: 'flex', justifyContent: 'flex-end' })}>
                    <button
                        type="button"
                        onClick={() => onCommitDependencies(nextDependencies)}
                        disabled={!hasDiff}
                        className={editorButton({ intent: 'success' })}
                    >
                        インストール
                    </button>
                </div>
            </PanelSection>

            <PanelSection title="レジストリ管理" defaultOpen={false}>
                <RegistryUrlManager registryUrls={registryUrls} onChange={setRegistryUrls} />
            </PanelSection>
        </div>
    );
}

function SourceLabel({ mod }: { mod: AvailableMod }) {
    const isLocal = mod.sourceLabel === 'local';
    return (
        <div className={css({ fontSize: '10px', mt: '2px', opacity: 0.85 })}>
            {isLocal ? (
                <span className={css({ color: 'textSubtle' })}>ローカル</span>
            ) : (
                <span className={css({ color: 'errorText' })}>外部 URL（要確認）</span>
            )}
        </div>
    );
}

function DiffRow({
    kind,
    dependency,
    fromVersion,
}: {
    kind: '追加' | '削除' | '更新';
    dependency: Dependency;
    fromVersion?: string;
}) {
    const color = kind === '追加' ? 'successText' : kind === '削除' ? 'errorText' : 'text';
    const external = dependency.source.type === 'url';
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '13px' })}>
            <span className={css({ color, fontWeight: '600' })}>
                {kind}: {dependency.name}
                {fromVersion
                    ? ` (v${fromVersion} → v${dependency.source.version})`
                    : ` · v${dependency.source.version}`}
            </span>
            <span className={css({ fontSize: '11px', color: external ? 'errorText' : 'textSubtle' })}>
                {external ? `外部 URL: ${dependency.source.url} — 実行前に内容を確認してください` : 'ローカル mod'}
            </span>
        </div>
    );
}
