import {
    buildWorldLock,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
    resolveLatestVersion,
} from '@ubichill/loader';
import {
    type Dependency,
    displayAuthorAccount,
    lockedMods,
    type ModLock,
    type ModLockEntry,
    PROTOCOL_VERSION,
    selectableProtocolVersions,
    type WorldRequirements,
} from '@ubichill/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ModThumbnail } from '@/components/mods/ModThumbnail';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import { confirmModUpdate } from '@/lib/mods/confirmUpdate';
import { HOST_MOD_SOURCE, MOD_CDN_URL } from '@/lib/mods/modCdn';
import { editorPackage } from '@/lib/mods/packages';
import { type AvailableMod, useAvailableMods } from '@/lib/mods/useAvailableMods';
import { useModAuthor } from '@/lib/mods/useModAuthor';
import { SETTINGS_KEYS, useSetting } from '@/lib/settings';
import { css, cx } from '@/styled-system/css';
import {
    checkModInstallation,
    describeModRejection,
    isUnsignedModAllowed,
    type ModInstallationCheck,
    modAuthorFetcher,
} from '@/world';
import { type ModListRow, modListRows } from '../../lib/modList';
import {
    computeModDiff,
    lockForSelection,
    type ModSelectionEntry,
    selectionToDependencies,
    selectionWithCheckedVersions,
} from '../../lib/modSelection';
import { editorButton } from '../../recipes/button';
import { PanelSection } from '../PanelSection';
import { RegistryUrlManager } from './RegistryUrlManager';

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((v) => typeof v === 'string');

const authorLine = css({ fontSize: '11px', mt: '2px', overflowWrap: 'anywhere', lineHeight: '1.5' });

/**
 * インストールする版の作者（署名で確認できたものだけ）。確認できない版は、本番の Host では実行されない。
 * 「署名が無い」「署名が通らない」「いまは確認できない」を分けて出す。
 */
function ModAuthor({ mod, version }: { mod: AvailableMod; version: string }) {
    const { state, retry } = useModAuthor(mod, version);
    if (state.status === 'data-only') return null;
    if (state.status === 'checking')
        return (
            <div className={cx(authorLine, css({ color: 'textSubtle' }))} role="status">
                v{version} の作者を確認中…
            </div>
        );
    if (state.status === 'verified') {
        return (
            <div className={cx(authorLine, css({ color: 'textSubtle' }))}>
                v{version} の作者 {displayAuthorAccount(state.author)}
            </div>
        );
    }
    if (state.status === 'unavailable') {
        return (
            <div
                className={cx(
                    authorLine,
                    css({ color: 'textSubtle', display: 'flex', alignItems: 'center', gap: '6px' }),
                )}
            >
                <span>v{version} の作者をいま確認できません</span>
                <button
                    type="button"
                    className={css({
                        color: 'primary',
                        fontWeight: '600',
                        cursor: 'pointer',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        minHeight: '32px',
                        px: '1',
                        bg: 'transparent',
                        border: 'none',
                        _focusVisible: { outline: '2px solid', outlineColor: 'primary' },
                    })}
                    onClick={(e) => {
                        e.stopPropagation();
                        retry();
                    }}
                >
                    再確認
                </button>
            </div>
        );
    }
    return (
        <div className={cx(authorLine, css({ color: 'errorText' }))}>
            v{version}:{' '}
            {state.status === 'unsigned' ? '作者の署名がありません' : describeModRejection(state.reason).message}
        </div>
    );
}

interface ModSelectorProps {
    /** 現在 definition に登録済みの依存（インストール済み mod）。 */
    dependencies: Dependency[];
    lock?: ModLock;
    /** ワールドが固定している ubichill の版（無ければ保存するときに今の版で固定する） */
    requires?: WorldRequirements;
    /** インストール確定時に、依存・lock・ubichill の版を置き換える。 */
    onCommit: (next: { dependencies: Dependency[]; lock?: ModLock; requires?: WorldRequirements }) => void;
}

const listBox = css({
    maxHeight: 'min(60vh, 560px)',
    overflowY: 'auto',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'background',
});
const rowGrid = css({
    display: 'grid',
    // 狭い画面では「最新」の列を隠す（古い版なら「更新」が出るので分かる）
    gridTemplateColumns: { base: 'minmax(0, 1fr) 88px 88px', md: 'minmax(0, 1fr) 104px 56px 96px' },
    alignItems: 'center',
    columnGap: '12px',
    px: '12px',
    py: '8px',
});
const headerRow = css({
    position: 'sticky',
    top: 0,
    zIndex: 1,
    bg: 'surface',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'border',
    fontSize: '11px',
    fontWeight: '600',
    color: 'textSubtle',
    py: '6px',
});
const listItem = css({
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'border',
    _first: { borderTopWidth: '0' },
});
const nameText = css({ fontSize: '13px', fontWeight: '600', color: 'text', overflowWrap: 'anywhere' });
const metaText = css({ fontSize: '11px', color: 'textSubtle', overflowWrap: 'anywhere', mt: '2px' });
const mutedCell = css({ fontSize: '12px', color: 'textSubtle' });
const versionSelect = css({
    width: '100%',
    fontSize: '12px',
    p: '4px 6px',
    borderRadius: '4px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
});
const actions = css({ display: 'flex', justifyContent: 'flex-end', gap: '4px' });
const wideOnly = css({ display: { base: 'none', md: 'block' } });

/**
 * 「mod管理」タブ。一覧での追加・版の選択・外すはローカルの選択状態に留め、
 * 「インストール」ボタンで初めて definition へ反映する。
 * 反映前に追加/削除/更新の差分と、外部 URL 由来 mod のセキュリティ注記を表示する。
 * ubichill の版も 1 行として同じように固定し、上げるときは同じ差分に出す。
 */
export function ModSelector({ dependencies, lock, requires, onCommit }: ModSelectorProps) {
    const confirm = useConfirm();
    const [installationError, setInstallationError] = useState('');
    const [registryUrls, setRegistryUrls] = useSetting<string[]>(SETTINGS_KEYS.editorRegistryUrls, [], isStringArray);
    const { mods, loading } = useAvailableMods(registryUrls);
    const [query, setQuery] = useState('');

    // 選択状態。タブを開くたびに現在の dependencies から初期化される（staging は保持しない）。
    const [selected, setSelected] = useState<ModSelectionEntry[]>(() =>
        dependencies.map((d) => ({
            id: d.name,
            version: d.source.version,
            baseUrl: d.source.url,
            author: d.source.author,
        })),
    );
    const pinnedProtocol = requires?.protocol ?? PROTOCOL_VERSION;
    const [protocol, setProtocol] = useState(pinnedProtocol);
    const protocolChanged = protocol !== pinnedProtocol;

    const nextDependencies = useMemo(() => selectionToDependencies(selected), [selected]);
    const diff = useMemo(() => computeModDiff(dependencies, nextDependencies), [dependencies, nextDependencies]);
    const modsChanged = diff.added.length > 0 || diff.removed.length > 0 || diff.updated.length > 0;
    const hasDiff = modsChanged || protocolChanged;
    // 読み込み中は mod 一覧が空のため、既存の依存を「一覧に無い mod」と誤判定しない。
    const rows = useMemo(
        () => (loading ? [] : modListRows({ mods, selected, dependencies, lock, query })),
        [loading, mods, selected, dependencies, lock, query],
    );

    const [installation, setInstallation] = useState<{ checking: boolean; failures: ModInstallationCheck[] }>({
        checking: false,
        failures: [],
    });
    const attemptRef = useRef(0);
    useEffect(
        () => () => {
            attemptRef.current += 1;
        },
        [],
    );
    const resetInstallation = () => {
        attemptRef.current += 1;
        setInstallation({ checking: false, failures: [] });
    };
    const commit = (next: Dependency[], nextLock: ModLock | undefined) =>
        onCommit({ dependencies: next, lock: nextLock, requires: protocolChanged ? { protocol } : requires });
    const install = async () => {
        if (!modsChanged) {
            commit(dependencies, lock);
            return;
        }
        const attempt = ++attemptRef.current;
        setInstallation({ checking: true, failures: [] });
        setInstallationError('');
        const changed = new Set([
            ...diff.added.map((dep) => dep.name),
            ...diff.updated.map((change) => change.to.name),
        ]);
        const checks = await checkModInstallation(
            nextDependencies.filter((dep) => changed.has(dep.name) || !lockedMods(lock)[dep.name]),
            {
                baseUrl: MOD_CDN_URL,
                resolveLatest: resolveLatestVersion,
                checkAuthor: modAuthorFetcher(HOST_MOD_SOURCE),
                allowUnsigned: (baseUrl) =>
                    isUnsignedModAllowed({ devHost: HOST_MOD_SOURCE.devHost, baseUrl, origin: window.location.origin }),
            },
        );
        if (attemptRef.current !== attempt) return;
        const failures = checks.filter((check) => !check.allowed);
        if (failures.length) {
            setInstallation({ checking: false, failures });
            return;
        }
        try {
            const next = selectionWithCheckedVersions(nextDependencies, checks);
            const get = createDependencyAwareLockEntryGetter(
                next,
                createHttpLockEntryGetter(MOD_CDN_URL),
                undefined,
                lock,
            );
            const resolved = await buildWorldLock(
                next.map((d) => d.name),
                get,
            );
            const proposed = lockForSelection(next, lock, resolved);
            await Promise.all(
                Object.values(lockedMods(proposed))
                    .filter((entry) => JSON.stringify(entry) !== JSON.stringify(lockedMods(lock)[entry.id]))
                    .map(editorPackage),
            );
            if (attemptRef.current !== attempt) return;
            if (!(await confirmModUpdate(lock, proposed, confirm))) return;
            if (attemptRef.current === attempt) commit(next, proposed);
        } catch (e) {
            if (attemptRef.current === attempt) setInstallationError(e instanceof Error ? e.message : '追加できません');
        } finally {
            if (attemptRef.current === attempt) setInstallation({ checking: false, failures: [] });
        }
    };

    const upsertSelected = (entry: ModSelectionEntry) =>
        setSelected((prev) => {
            const exists = prev.some((e) => e.id === entry.id);
            return exists ? prev.map((e) => (e.id === entry.id ? entry : e)) : [...prev, entry];
        });
    const add = (p: AvailableMod) => {
        resetInstallation();
        upsertSelected({ id: p.id, version: p.version, baseUrl: p.baseUrl });
    };
    const remove = (id: string) => {
        resetInstallation();
        setSelected((prev) => prev.filter((e) => e.id !== id));
    };
    const changeVersion = (p: AvailableMod, version: string) => {
        resetInstallation();
        const existing = selected.find((e) => e.id === p.id);
        upsertSelected({ id: p.id, version, baseUrl: p.baseUrl, author: existing?.author });
    };

    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '3' })}>
            {installationError && <p role="alert">{installationError}</p>}
            <PanelSection title="使用するmod">
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}>
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="名前・ID・作者で絞り込む"
                        aria-label="mod を絞り込む"
                        className={css({
                            width: '100%',
                            fontSize: '13px',
                            p: '8px 12px',
                            borderRadius: '8px',
                            border: '1px solid',
                            borderColor: 'border',
                            bg: 'background',
                            color: 'text',
                        })}
                    />
                    <div className={listBox}>
                        <div className={cx(rowGrid, headerRow)} aria-hidden="true">
                            <span>名前</span>
                            <span>使う版</span>
                            <span className={wideOnly}>最新</span>
                            <span />
                        </div>
                        <ul aria-label="ubichill と mod の一覧">
                            <li className={listItem}>
                                <UbichillRow current={protocol} pinned={pinnedProtocol} onChange={setProtocol} />
                            </li>
                            {rows.map((row) => (
                                <li key={row.key} className={listItem}>
                                    {row.kind === 'available' ? (
                                        <AvailableModRow
                                            row={row}
                                            locked={lockedMods(lock)[row.mod.id]}
                                            onAdd={() => add(row.mod)}
                                            onRemove={() => remove(row.mod.id)}
                                            onVersion={(version) => changeVersion(row.mod, version)}
                                        />
                                    ) : (
                                        <ExtraModRow
                                            entry={row.entry}
                                            locked={lockedMods(lock)[row.entry.id]}
                                            onRemove={() => remove(row.entry.id)}
                                        />
                                    )}
                                </li>
                            ))}
                        </ul>
                        {(loading || rows.length === 0) && (
                            <p className={css({ fontSize: '13px', color: 'textMuted', p: '12px' })}>
                                {loading
                                    ? 'mod を読み込み中…'
                                    : query
                                      ? '一致する mod はありません'
                                      : '利用可能なmodが見つかりません'}
                            </p>
                        )}
                    </div>
                </div>
            </PanelSection>

            <PanelSection title="インストール差分">
                {hasDiff ? (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
                        {protocolChanged && (
                            <span className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>
                                更新: ubichill (v{pinnedProtocol} → v{protocol})
                            </span>
                        )}
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
                {installation.failures.length > 0 && (
                    <div
                        role="alert"
                        className={css({
                            mt: '3',
                            p: '3',
                            border: '1px solid',
                            borderColor: 'border',
                            borderRadius: '8px',
                            color: 'errorText',
                            fontSize: '13px',
                        })}
                    >
                        <p>利用できない mod があるため、変更を反映しませんでした。</p>
                        <ul>
                            {installation.failures.map((check) => (
                                <li key={check.modId}>
                                    {check.modId}
                                    {check.version ? ` v${check.version}` : ''}:{' '}
                                    {check.result.status === 'unsigned'
                                        ? 'この版には作者の署名がなく、本番では利用できません。別の版を選ぶか、一覧から外してください。'
                                        : check.result.status === 'rejected'
                                          ? `${describeModRejection(check.result.reason).message}。別の版を選ぶか、一覧から外してください。`
                                          : 'いまは確認できません。時間をおいて再確認してください。'}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                <div className={css({ mt: '3', display: 'flex', justifyContent: 'flex-end' })}>
                    <button
                        type="button"
                        onClick={install}
                        disabled={!hasDiff || installation.checking || (modsChanged && loading)}
                        className={editorButton({ intent: 'success' })}
                    >
                        {installation.checking
                            ? '利用可否を確認中…'
                            : installation.failures.length > 0
                              ? '再確認してインストール'
                              : '確認してインストール'}
                    </button>
                </div>
            </PanelSection>

            <PanelSection title="レジストリ管理" defaultOpen={false}>
                <RegistryUrlManager registryUrls={registryUrls} onChange={setRegistryUrls} />
            </PanelSection>
        </div>
    );
}

/** ubichill の版。mod と同じく固定し、上げるのは作者が選んだときだけ（下げる選択肢は出さない）。 */
const nameCell = css({ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 });

function UbichillRow({
    current,
    pinned,
    onChange,
}: {
    current: number;
    pinned: number;
    onChange: (protocol: number) => void;
}) {
    const outdated = current < PROTOCOL_VERSION;
    return (
        <div className={rowGrid}>
            <div className={nameCell}>
                <img src="/icon.png" alt="" width={32} height={32} className={css({ borderRadius: '4px' })} />
                <div>
                    <div className={nameText}>ubichill</div>
                    <div className={metaText}>本体の機能の版</div>
                </div>
            </div>
            <select
                aria-label="ubichill の版"
                value={current}
                onChange={(e) => onChange(Number(e.target.value))}
                className={versionSelect}
            >
                {selectableProtocolVersions(pinned).map((version) => (
                    <option key={version} value={version}>
                        v{version}
                    </option>
                ))}
            </select>
            <LatestVersion version={`v${PROTOCOL_VERSION}`} outdated={outdated} />
            <div className={actions}>
                {outdated && (
                    <button
                        type="button"
                        onClick={() => onChange(PROTOCOL_VERSION)}
                        className={editorButton({ size: 'sm' })}
                    >
                        更新
                    </button>
                )}
            </div>
        </div>
    );
}

function AvailableModRow({
    row,
    locked,
    onAdd,
    onRemove,
    onVersion,
}: {
    row: Extract<ModListRow<AvailableMod>, { kind: 'available' }>;
    locked?: ModLockEntry;
    onAdd: () => void;
    onRemove: () => void;
    onVersion: (version: string) => void;
}) {
    const { mod } = row;
    return (
        <div className={cx(rowGrid, row.selected && css({ bg: 'surfaceAccent' }))}>
            <div className={nameCell}>
                <ModThumbnail target={{ id: mod.id, version: row.version, baseUrl: mod.baseUrl }} locked={locked} />
                <div className={css({ minWidth: 0 })}>
                    <div className={nameText}>{mod.name}</div>
                    <div className={metaText}>
                        {mod.id === mod.name ? '' : `${mod.id} · `}
                        {sourceHost(mod)}
                    </div>
                    {row.selected && <ModAuthor mod={mod} version={row.version} />}
                </div>
            </div>
            {row.selected ? (
                <select
                    aria-label={`${mod.name} の版`}
                    value={row.version}
                    onChange={(e) => onVersion(e.target.value)}
                    className={versionSelect}
                >
                    {row.versions.map((version) => (
                        <option key={version} value={version}>
                            v{version}
                        </option>
                    ))}
                </select>
            ) : (
                <span className={mutedCell}>—</span>
            )}
            <LatestVersion version={`v${mod.version}`} outdated={row.outdated} />
            <div className={actions}>
                {!row.selected ? (
                    <button
                        type="button"
                        onClick={onAdd}
                        disabled={row.blocked}
                        title={row.blocked ? '同じ ID の mod が別の取得元から入っています' : undefined}
                        aria-label={`${mod.name} を追加`}
                        className={editorButton({ size: 'sm' })}
                    >
                        追加
                    </button>
                ) : (
                    <>
                        {row.outdated && (
                            <button
                                type="button"
                                onClick={() => onVersion(mod.version)}
                                aria-label={`${mod.name} を v${mod.version} に更新`}
                                className={editorButton({ size: 'sm' })}
                            >
                                更新
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onRemove}
                            aria-label={`${mod.name} を外す`}
                            className={editorButton({ intent: 'icon', size: 'sm' })}
                        >
                            外す
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}

/** 取得元の一覧に無い依存（作者参照で入れた mod など）。版を変えるときは作品ページから入れ直す。 */
function ExtraModRow({
    entry,
    locked,
    onRemove,
}: {
    entry: ModSelectionEntry;
    locked?: ModLockEntry;
    onRemove: () => void;
}) {
    const label = entry.author ? `@${entry.author}/${entry.id}` : entry.id;
    const version = entry.version === 'latest' ? locked?.version : entry.version;
    return (
        <div className={rowGrid}>
            <div className={nameCell}>
                <ModThumbnail
                    target={version ? { id: entry.id, version, baseUrl: entry.baseUrl } : undefined}
                    locked={locked}
                />
                <div className={css({ minWidth: 0 })}>
                    <div className={nameText}>{label}</div>
                    <div className={metaText}>
                        {entry.baseUrl ? (URL.parse(entry.baseUrl)?.host ?? entry.baseUrl) : '一覧に無い mod'}
                    </div>
                </div>
            </div>
            <span className={mutedCell}>{entry.version === 'latest' ? '—' : `v${entry.version}`}</span>
            <span className={cx(mutedCell, wideOnly)}>—</span>
            <div className={actions}>
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`${label} を外す`}
                    className={editorButton({ intent: 'icon', size: 'sm' })}
                >
                    外す
                </button>
            </div>
        </div>
    );
}

function LatestVersion({ version, outdated }: { version: string; outdated: boolean }) {
    return (
        <span
            className={cx(
                outdated ? css({ fontSize: '12px', fontWeight: '600', color: 'primary' }) : mutedCell,
                wideOnly,
            )}
        >
            {version}
        </span>
    );
}

function sourceHost(mod: AvailableMod): string {
    return URL.parse(mod.baseUrl ?? MOD_CDN_URL, window.location.origin)?.host ?? mod.sourceLabel;
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
    const external = dependency.source.url !== undefined;
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
