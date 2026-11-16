import {
    type Dependency,
    type InitialEntity,
    lockedMods,
    type ModLock,
    PROTOCOL_VERSION,
    parseAuthorAccount,
    parsePackageRef,
    type WorldRequirements,
} from '@ubichill/shared';
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { HudIcon, type HudIconName } from '@/components/hud/HudIcon';
import { useAvailableMods } from '@/lib/mods/useAvailableMods';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css, cx } from '@/styled-system/css';
import { type CatalogScope, useModCatalog, useResolvedPackage } from '../../hooks/useModCatalog';
import { type ModCommit, type ModInstallProblem, useModInstaller } from '../../hooks/useModInstaller';
import {
    candidateFromIndex,
    candidateFromPackage,
    candidateStatus,
    checkable,
    installedMods,
    type ModCandidate,
    matchesCandidate,
    modUsage,
    removalWarning,
    selectableCandidates,
    uniqueCandidates,
    withCandidates,
    withDependencies,
    withoutDependencies,
} from '../../lib/modCatalog';
import { installFailureText } from '../../lib/modInstall';
import { editorButton } from '../../recipes/button';
import { RegistryUrlManager } from '../forms/RegistryUrlManager';
import { PanelSection } from '../PanelSection';
import { CandidateRow, InstalledRow, listBox, SelectBox, UbichillRow } from './ModRows';

export type ModTab = 'installed' | 'local' | 'global' | 'registry';

const TABS: ReadonlyArray<{ id: ModTab; label: string; icon: HudIconName }> = [
    { id: 'installed', label: '使用中', icon: 'puzzle' },
    { id: 'local', label: 'ローカル', icon: 'server' },
    { id: 'global', label: 'グローバル', icon: 'globe' },
    { id: 'registry', label: 'レジストリ', icon: 'link' },
];

const PLACEHOLDER: Record<ModTab, string> = {
    installed: '使用中の mod を絞り込む',
    local: '名前・ID・作者、@作者@サーバー/mod、作品 URL',
    global: '名前・ID・作者、@作者@サーバー/mod、作品 URL',
    registry: '名前・ID で絞り込む',
};

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string');

/** 作者参照で開いたら、作者のサーバーがここならローカル、ほかならグローバル。mod が無ければ探すところから。 */
function initialTab(query: string, installedCount: number): ModTab {
    const ref = parsePackageRef(query.trim());
    if (ref) return parseAuthorAccount(ref.author)?.domain === window.location.host ? 'local' : 'global';
    return installedCount > 0 ? 'installed' : 'local';
}

interface ModManagerProps {
    dependencies: Dependency[];
    lock?: ModLock;
    /** ワールドが固定している ubichill の版（無ければ保存するときに今の版で固定する） */
    requires?: WorldRequirements;
    /** 外す前に、その mod の Component を使っている Entity を数える */
    entities: InitialEntity[];
    /** 作品ページから来たときの作者参照（`?addMod=`） */
    initialQuery?: string;
    onCommit: (next: ModCommit) => void;
}

/**
 * 「mod管理」タブ。使用中・ローカル（このサーバー）・グローバル（フォロー中のサーバー）・レジストリを切り替えて探し、
 * 追加・版の変更・外すはその場で反映する。チェックした mod はまとめて追加・更新・外せる。
 */
export function ModManager({ dependencies, lock, requires, entities, initialQuery = '', onCommit }: ModManagerProps) {
    const [tab, setTab] = useState<ModTab>(() => initialTab(initialQuery, dependencies.length));
    const [query, setQuery] = useState(initialQuery);
    const [checkedCandidates, setCheckedCandidates] = useState<ModCandidate[]>([]);
    const [checkedInstalled, setCheckedInstalled] = useState<string[]>([]);
    const [registryUrls, setRegistryUrls] = useSetting<string[]>(SETTINGS_KEYS.editorRegistryUrls, [], isStringArray);
    const index = useAvailableMods(registryUrls);
    const installer = useModInstaller({ dependencies, lock, requires, onCommit });
    const usage = useMemo(() => modUsage(entities), [entities]);

    const hostCandidates = useMemo(() => index.host.map(candidateFromIndex), [index.host]);
    const registryCandidates = useMemo(() => index.registries.map(candidateFromIndex), [index.registries]);
    const catalogScope: CatalogScope = tab === 'global' ? 'global' : 'local';
    const catalog = useModCatalog(catalogScope, query, tab === 'local' || tab === 'global');
    const resolved = useResolvedPackage(tab === 'local' || tab === 'global' ? query : '');

    const switchTab = (next: ModTab) => {
        setTab(next);
        setCheckedCandidates([]);
        setCheckedInstalled([]);
    };
    const busy = installer.busy !== null;

    const addCandidates = async (key: string, list: readonly ModCandidate[]) => {
        if (await installer.apply(key, withCandidates(dependencies, lock, list))) setCheckedCandidates([]);
    };
    const changeVersion = (dependency: Dependency, version: string) =>
        installer.apply(
            `version:${dependency.name}`,
            withDependencies(dependencies, [{ ...dependency, source: { ...dependency.source, version } }]),
        );
    const updateAll = async (next: Dependency[]) => {
        if (await installer.apply('bulk-update', withDependencies(dependencies, next))) setCheckedInstalled([]);
    };
    const remove = async (key: string, names: readonly string[]) => {
        const ok = await installer.apply(key, withoutDependencies(dependencies, new Set(names)), {
            confirmMessage: removalWarning(names, usage),
        });
        if (ok) setCheckedInstalled([]);
    };

    const isRef = parsePackageRef(query.trim()) !== null;
    const searchCandidates = (base: readonly ModCandidate[]) =>
        uniqueCandidates([
            ...(resolved.candidate ? [resolved.candidate] : []),
            ...(isRef ? [] : base.filter((c) => matchesCandidate(c, query))),
        ]);

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            <ModTabBar current={tab} installedCount={dependencies.length} onSelect={switchTab} disabled={busy} />
            <SearchBox value={query} placeholder={PLACEHOLDER[tab]} onChange={setQuery} />
            {installer.problem && <ProblemNotice problem={installer.problem} onDismiss={installer.dismissProblem} />}
            <div role="tabpanel" id={`mod-panel-${tab}`} aria-labelledby={`mod-tab-${tab}`}>
                {tab === 'installed' ? (
                    <InstalledPanel
                        dependencies={dependencies}
                        lock={lock}
                        requires={requires}
                        candidates={[...hostCandidates, ...registryCandidates]}
                        query={query}
                        checked={checkedInstalled}
                        busyKey={installer.busy}
                        onCheck={setCheckedInstalled}
                        onVersion={changeVersion}
                        onUpdate={updateAll}
                        onRemove={remove}
                        onProtocol={(protocol) =>
                            void installer.apply('protocol', dependencies, { requires: { protocol } })
                        }
                        onFind={() => switchTab('local')}
                    />
                ) : (
                    <CandidatePanel
                        candidates={
                            tab === 'local'
                                ? searchCandidates([...hostCandidates, ...catalog.items.map(candidateFromPackage)])
                                : tab === 'global'
                                  ? searchCandidates(catalog.items.map(candidateFromPackage))
                                  : registryCandidates.filter((c) => matchesCandidate(c, query))
                        }
                        dependencies={dependencies}
                        lock={lock}
                        loading={
                            tab === 'registry'
                                ? index.loading
                                : resolved.resolving || catalog.loading || (tab === 'local' && index.loading)
                        }
                        error={tab === 'registry' ? '' : resolved.error || catalog.error}
                        emptyText={emptyText(tab, query, registryUrls.length)}
                        checked={checkedCandidates}
                        busyKey={installer.busy}
                        onCheck={setCheckedCandidates}
                        onAdd={addCandidates}
                        onLoadMore={tab === 'registry' ? undefined : catalog.loadMore}
                    />
                )}
            </div>
            {tab === 'registry' && (
                <PanelSection title="レジストリの管理" defaultOpen={registryUrls.length === 0}>
                    <RegistryUrlManager registryUrls={registryUrls} onChange={setRegistryUrls} />
                </PanelSection>
            )}
        </div>
    );
}

function emptyText(tab: ModTab, query: string, registryCount: number): string {
    if (query.trim()) return '一致する mod はありません';
    if (tab === 'local') return 'このサーバーに公開されている mod はありません';
    if (tab === 'global')
        return 'フォロー中のサーバーに公開されている mod はありません。@作者@サーバー/mod や作品 URL でも追加できます';
    return registryCount === 0 ? 'レジストリを追加すると、その mod がここに並びます' : 'mod はありません';
}

const tabList = css({
    display: 'flex',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
    overflowX: 'auto',
    scrollbarWidth: 'none',
});
const tabButton = css({
    flex: '1 1 0',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    minHeight: '44px',
    px: '3',
    fontSize: '13px',
    fontWeight: '600',
    color: 'textMuted',
    bg: 'transparent',
    border: 'none',
    borderBottomWidth: '2px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'transparent',
    marginBottom: '-1px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    _hover: { color: 'text' },
    _selected: { color: 'primary', borderBottomColor: 'primary' },
    _disabled: { cursor: 'not-allowed', opacity: 0.6 },
    _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '-2px' },
});
// 狭い画面では、選んでいないタブは印だけにする（名前は aria-label で読める）
const tabLabel = css({ display: { base: 'none', md: 'inline' }, '[aria-selected=true] &': { display: 'inline' } });
const tabCount = css({
    minWidth: '18px',
    px: '5px',
    borderRadius: '9px',
    bg: 'surfaceAccent',
    color: 'textMuted',
    fontSize: '11px',
    lineHeight: '18px',
    textAlign: 'center',
});

function ModTabBar({
    current,
    installedCount,
    disabled,
    onSelect,
}: {
    current: ModTab;
    installedCount: number;
    disabled: boolean;
    onSelect: (tab: ModTab) => void;
}) {
    const refs = useRef<Partial<Record<ModTab, HTMLButtonElement | null>>>({});
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step || disabled) return;
        e.preventDefault();
        const index = TABS.findIndex((t) => t.id === current);
        const next = TABS[(index + step + TABS.length) % TABS.length].id;
        onSelect(next);
        refs.current[next]?.focus();
    };
    return (
        <div role="tablist" aria-label="mod の一覧" className={tabList} onKeyDown={onKeyDown}>
            {TABS.map((t) => {
                const selected = t.id === current;
                return (
                    <button
                        key={t.id}
                        ref={(el) => {
                            refs.current[t.id] = el;
                        }}
                        type="button"
                        role="tab"
                        id={`mod-tab-${t.id}`}
                        aria-controls={`mod-panel-${t.id}`}
                        aria-selected={selected}
                        aria-label={t.id === 'installed' ? `${t.label} ${installedCount} 件` : t.label}
                        tabIndex={selected ? 0 : -1}
                        disabled={disabled && !selected}
                        onClick={() => onSelect(t.id)}
                        className={tabButton}
                    >
                        <HudIcon name={t.icon} size={16} />
                        <span className={tabLabel}>{t.label}</span>
                        {t.id === 'installed' && installedCount > 0 && (
                            <span className={tabCount}>{installedCount}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

function SearchBox({
    value,
    placeholder,
    onChange,
}: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className={css({ position: 'relative' })}>
            <span
                className={css({
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    color: 'textSubtle',
                    pointerEvents: 'none',
                })}
            >
                <HudIcon name="search" size={16} />
            </span>
            <input
                type="search"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                aria-label="mod を探す"
                maxLength={2048}
                className={css({
                    width: '100%',
                    minHeight: '40px',
                    fontSize: '13px',
                    p: '8px 12px 8px 34px',
                    borderRadius: '8px',
                    border: '1px solid',
                    borderColor: 'border',
                    bg: 'background',
                    color: 'text',
                    _focusVisible: { outline: '2px solid', outlineColor: 'primary', outlineOffset: '-1px' },
                })}
            />
        </div>
    );
}

const toolbar = css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '44px',
    px: '12px',
    py: '6px',
    bg: 'surface',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
    fontSize: '12px',
    color: 'textMuted',
});
const statusText = css({ fontSize: '13px', color: 'textMuted', p: '12px' });

/** 一覧の上の帯。すべて選択と、選んだものへの操作。 */
function SelectionBar({
    total,
    checkedCount,
    allChecked,
    canCheckAll,
    onToggleAll,
    children,
}: {
    total: number;
    checkedCount: number;
    allChecked: boolean;
    canCheckAll: boolean;
    onToggleAll: (checked: boolean) => void;
    children?: ReactNode;
}) {
    return (
        <div className={toolbar}>
            <SelectBox
                checked={allChecked}
                indeterminate={checkedCount > 0 && !allChecked}
                disabled={!canCheckAll && checkedCount === 0}
                label="表示中の mod をすべて選ぶ"
                onChange={onToggleAll}
            />
            <span aria-live="polite">{checkedCount > 0 ? `${checkedCount} 件を選択` : `${total} 件`}</span>
            <span className={css({ flex: 1 })} />
            {checkedCount > 0 && children}
        </div>
    );
}

function CandidatePanel({
    candidates,
    dependencies,
    lock,
    loading,
    error,
    emptyText,
    checked,
    busyKey,
    onCheck,
    onAdd,
    onLoadMore,
}: {
    candidates: ModCandidate[];
    dependencies: Dependency[];
    lock?: ModLock;
    loading: boolean;
    error: string;
    emptyText: string;
    checked: ModCandidate[];
    busyKey: string | null;
    onCheck: (next: ModCandidate[]) => void;
    onAdd: (key: string, list: readonly ModCandidate[]) => void;
    onLoadMore?: () => void;
}) {
    const rows = candidates.map((candidate) => ({ candidate, status: candidateStatus(candidate, dependencies, lock) }));
    const isChecked = (candidate: ModCandidate) => checked.some((c) => c.key === candidate.key);
    const all = selectableCandidates(rows, checked);
    const allChecked = all.length > 0 && all.every(isChecked);
    const busy = busyKey !== null;
    return (
        <div className={listBox}>
            <SelectionBar
                total={rows.length}
                checkedCount={checked.length}
                allChecked={allChecked}
                canCheckAll={all.length > 0}
                onToggleAll={(on) =>
                    onCheck(
                        on
                            ? uniqueCandidates([...checked, ...all])
                            : checked.filter((c) => !all.some((a) => a.key === c.key)),
                    )
                }
            >
                <button
                    type="button"
                    onClick={() => onCheck([])}
                    disabled={busy}
                    className={editorButton({ size: 'sm' })}
                >
                    選択を解除
                </button>
                <button
                    type="button"
                    onClick={() => onAdd('bulk', checked)}
                    disabled={busy}
                    className={editorButton({ intent: 'primary', size: 'sm' })}
                >
                    {busyKey === 'bulk' ? '確認中…' : `${checked.length} 件を追加`}
                </button>
            </SelectionBar>
            {rows.map(({ candidate, status }) => (
                <CandidateRow
                    key={candidate.key}
                    candidate={candidate}
                    status={status}
                    checked={isChecked(candidate)}
                    canCheck={checkable(candidate, status, checked)}
                    busy={busyKey === `add:${candidate.key}`}
                    disabled={busy}
                    onCheck={(on) =>
                        onCheck(on ? [...checked, candidate] : checked.filter((c) => c.key !== candidate.key))
                    }
                    onAdd={() => onAdd(`add:${candidate.key}`, [candidate])}
                />
            ))}
            {error && (
                <p role="alert" className={cx(statusText, css({ color: 'errorText' }))}>
                    {error}
                </p>
            )}
            {loading ? (
                <p role="status" className={statusText}>
                    読み込み中…
                </p>
            ) : (
                rows.length === 0 && !error && <p className={statusText}>{emptyText}</p>
            )}
            {onLoadMore && !loading && (
                <div className={css({ display: 'flex', justifyContent: 'center', p: '8px' })}>
                    <button type="button" onClick={onLoadMore} className={editorButton({ size: 'sm' })}>
                        さらに読み込む
                    </button>
                </div>
            )}
        </div>
    );
}

function InstalledPanel({
    dependencies,
    lock,
    requires,
    candidates,
    query,
    checked,
    busyKey,
    onCheck,
    onVersion,
    onUpdate,
    onRemove,
    onProtocol,
    onFind,
}: {
    dependencies: Dependency[];
    lock?: ModLock;
    requires?: WorldRequirements;
    candidates: ModCandidate[];
    query: string;
    checked: string[];
    busyKey: string | null;
    onCheck: (next: string[]) => void;
    onVersion: (dependency: Dependency, version: string) => void;
    onUpdate: (next: Dependency[]) => void;
    onRemove: (key: string, names: readonly string[]) => void;
    onProtocol: (protocol: number) => void;
    onFind: () => void;
}) {
    const q = query.trim().toLowerCase();
    const mods = installedMods(dependencies, lock, candidates).filter(
        ({ dependency, candidate }) =>
            !q ||
            [dependency.name, dependency.source.author, candidate?.name].some((text) =>
                text?.toLowerCase().includes(q),
            ),
    );
    const names = mods.map((m) => m.dependency.name);
    const checkedMods = mods.filter((m) => checked.includes(m.dependency.name));
    const outdated = checkedMods.filter((m) => m.outdated && m.candidate);
    const busy = busyKey !== null;
    const allChecked = names.length > 0 && names.every((name) => checked.includes(name));
    return (
        <div className={listBox}>
            <SelectionBar
                total={mods.length}
                checkedCount={checked.length}
                allChecked={allChecked}
                canCheckAll={names.length > 0}
                onToggleAll={(on) =>
                    onCheck(on ? [...new Set([...checked, ...names])] : checked.filter((n) => !names.includes(n)))
                }
            >
                {outdated.length > 0 && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                            onUpdate(
                                outdated.flatMap((m) =>
                                    m.candidate
                                        ? [
                                              {
                                                  ...m.dependency,
                                                  source: { ...m.dependency.source, version: m.candidate.version },
                                              },
                                          ]
                                        : [],
                                ),
                            )
                        }
                        className={editorButton({ size: 'sm' })}
                    >
                        {busyKey === 'bulk-update' ? '確認中…' : `${outdated.length} 件を更新`}
                    </button>
                )}
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemove('bulk-remove', checked)}
                    className={editorButton({ intent: 'danger', size: 'sm' })}
                >
                    {busyKey === 'bulk-remove' ? '確認中…' : `${checked.length} 件を外す`}
                </button>
            </SelectionBar>
            {!q && (
                <UbichillRow pinned={requires?.protocol ?? PROTOCOL_VERSION} disabled={busy} onChange={onProtocol} />
            )}
            {mods.map((mod) => (
                <InstalledRow
                    key={mod.dependency.name}
                    mod={mod}
                    locked={lockedMods(lock)[mod.dependency.name]}
                    checked={checked.includes(mod.dependency.name)}
                    busyKey={busyKey}
                    disabled={busy}
                    onCheck={(on) =>
                        onCheck(
                            on ? [...checked, mod.dependency.name] : checked.filter((n) => n !== mod.dependency.name),
                        )
                    }
                    onVersion={(version) => onVersion(mod.dependency, version)}
                    onRemove={() => onRemove(`remove:${mod.dependency.name}`, [mod.dependency.name])}
                />
            ))}
            {mods.length === 0 &&
                (q ? (
                    <p className={statusText}>一致する mod はありません</p>
                ) : (
                    <div className={cx(statusText, css({ display: 'flex', alignItems: 'center', gap: '12px' }))}>
                        <span>mod はまだ入っていません</span>
                        <button type="button" onClick={onFind} className={editorButton({ size: 'sm' })}>
                            ローカルから探す
                        </button>
                    </div>
                ))}
        </div>
    );
}

function ProblemNotice({ problem, onDismiss }: { problem: ModInstallProblem; onDismiss: () => void }) {
    return (
        <div
            role="alert"
            className={css({
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                p: '12px',
                border: '1px solid',
                borderColor: 'errorLight',
                borderRadius: '8px',
                bg: 'errorBg',
                color: 'errorText',
                fontSize: '13px',
                lineHeight: '1.6',
            })}
        >
            <div className={css({ flex: 1, minWidth: 0, overflowWrap: 'anywhere' })}>
                {problem.error ? (
                    <p>{problem.error}</p>
                ) : (
                    <>
                        <p className={css({ fontWeight: '600' })}>確かめられない mod があるため、反映しませんでした</p>
                        <ul className={css({ mt: '1', pl: '4', listStyle: 'disc' })}>
                            {problem.failures.map((check) => (
                                <li key={check.modId}>
                                    {check.modId}
                                    {check.version ? ` v${check.version}` : ''}: {installFailureText(check)}
                                </li>
                            ))}
                        </ul>
                    </>
                )}
            </div>
            <button
                type="button"
                onClick={onDismiss}
                aria-label="閉じる"
                className={editorButton({ intent: 'icon', size: 'iconSm' })}
            >
                <HudIcon name="close" size={16} />
            </button>
        </div>
    );
}
