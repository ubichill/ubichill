import {
    displayAuthorAccount,
    formatPackageRef,
    type ModFavoriteRef,
    type ModLockEntry,
    PROTOCOL_VERSION,
    selectableProtocolVersions,
} from '@ubichill/shared';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { HudIcon } from '@/components/hud/HudIcon';
import { ModFavoriteButton } from '@/components/mods/ModFavoriteButton';
import { ModThumbnail } from '@/components/mods/ModThumbnail';
import { useModPreview } from '@/components/mods/useModPreview';
import { MOD_CDN_URL } from '@/lib/mods/modCdn';
import { useModAuthor } from '@/lib/mods/useModAuthor';
import { css, cx } from '@/styled-system/css';
import { describeModRejection } from '@/world';
import type { CandidateStatus, InstalledMod, ModCandidate } from '../../lib/modCatalog';
import { editorButton } from '../../recipes/button';

export const listBox = css({
    maxHeight: 'min(60vh, 560px)',
    overflowY: 'auto',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    bg: 'background',
});
const row = css({
    display: 'grid',
    gridTemplateColumns: { base: '18px 40px minmax(0, 1fr)', md: '18px 40px minmax(0, 1fr) auto' },
    gridTemplateAreas: { base: '"check thumb info" ". . actions"', md: '"check thumb info actions"' },
    columnGap: '12px',
    rowGap: '8px',
    alignItems: 'center',
    px: '12px',
    py: '10px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'border',
    _first: { borderTopWidth: '0' },
});
const checkedRow = css({ bg: 'surfaceAccent' });
const checkCell = css({ gridArea: 'check', display: 'flex' });
const thumbCell = css({ gridArea: 'thumb', display: 'flex' });
const infoCell = css({ gridArea: 'info', minWidth: 0, cursor: 'pointer' });
const actionsCell = css({
    gridArea: 'actions',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '6px',
    justifyContent: { base: 'flex-start', md: 'flex-end' },
});
const checkbox = css({
    width: '18px',
    height: '18px',
    accentColor: 'primary',
    cursor: 'pointer',
    _disabled: { cursor: 'not-allowed', opacity: 0.35 },
});
const titleLine = css({ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 });
const nameText = css({ fontSize: '13px', fontWeight: '600', color: 'text', overflowWrap: 'anywhere' });
const versionText = css({ fontSize: '11px', color: 'textSubtle', flexShrink: 0 });
const descriptionText = css({
    mt: '2px',
    fontSize: '12px',
    lineHeight: '1.5',
    color: 'textMuted',
    lineClamp: '2',
    whiteSpace: 'pre-line',
    overflowWrap: 'anywhere',
});
const metaText = css({ mt: '2px', fontSize: '11px', color: 'textSubtle', overflowWrap: 'anywhere' });
const installedBadge = css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    fontWeight: '600',
    color: 'successText',
    whiteSpace: 'nowrap',
});
const noteText = css({ fontSize: '11px', color: 'textSubtle' });
const favoriteButton = editorButton({ intent: 'icon', size: 'iconSm' });
const versionSelect = css({
    minWidth: '88px',
    fontSize: '12px',
    p: '4px 6px',
    borderRadius: '4px',
    border: '1px solid',
    borderColor: 'border',
    bg: 'background',
    color: 'text',
});

/** 選択のチェック。indeterminate は一部だけ選んだ状態（ツールバーのすべて選択）。 */
export function SelectBox({
    id,
    checked,
    indeterminate = false,
    disabled = false,
    label,
    onChange,
}: {
    id?: string;
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    label: string;
    onChange: (checked: boolean) => void;
}) {
    const ref = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = indeterminate;
    }, [indeterminate]);
    return (
        <input
            ref={ref}
            id={id}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            aria-label={label}
            onChange={(e) => onChange(e.target.checked)}
            className={checkbox}
        />
    );
}

function ModInfo({
    labelFor,
    name,
    version,
    description,
    meta,
    children,
}: {
    labelFor: string;
    name: string;
    version?: string;
    description?: string;
    meta: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className={infoCell}>
            {/* 名前・説明を押してもチェックが切り替わる */}
            <label htmlFor={labelFor} className={css({ display: 'block', cursor: 'inherit' })}>
                <span className={titleLine}>
                    <span className={nameText}>{name}</span>
                    {version && <span className={versionText}>v{version}</span>}
                </span>
                {description && <span className={cx(descriptionText, css({ display: 'block' }))}>{description}</span>}
                <span className={cx(metaText, css({ display: 'block' }))}>{meta}</span>
            </label>
            {children}
        </div>
    );
}

function hostOf(baseUrl: string | undefined): string {
    return URL.parse(baseUrl ?? MOD_CDN_URL, window.location.origin)?.host ?? '';
}

/** 一覧の出どころ。作者参照の mod は作者、それ以外は取得元のホスト。 */
function sourceLabel(target: { id: string; name: string; baseUrl?: string; author?: string }): string {
    const origin = target.author ? `@${target.author}` : hostOf(target.baseUrl);
    return target.id === target.name ? origin : `${target.id} · ${origin}`;
}

/** ローカル・グローバル・レジストリの 1 行。 */
export function CandidateRow({
    candidate,
    status,
    checked,
    canCheck,
    busy,
    disabled,
    onCheck,
    onAdd,
}: {
    candidate: ModCandidate;
    status: CandidateStatus;
    checked: boolean;
    canCheck: boolean;
    /** この行の操作を確かめている */
    busy: boolean;
    /** ほかの操作を確かめている */
    disabled: boolean;
    onCheck: (checked: boolean) => void;
    onAdd: () => void;
}) {
    const id = useId();
    const preview = useModPreview({ id: candidate.id, version: candidate.version, baseUrl: candidate.baseUrl });
    const name = preview?.name ?? candidate.name;
    const meta =
        status.kind === 'installed' && status.outdated && status.version
            ? `${sourceLabel({ ...candidate, name })} · v${status.version} を使用中`
            : sourceLabel({ ...candidate, name });
    return (
        <div className={cx(row, checked && checkedRow)}>
            <div className={checkCell}>
                <SelectBox
                    id={id}
                    checked={checked}
                    disabled={!canCheck && !checked}
                    label={`${name} を選ぶ`}
                    onChange={onCheck}
                />
            </div>
            <div className={thumbCell}>
                <ModThumbnail image={preview?.thumbnail} size={40} />
            </div>
            <ModInfo
                labelFor={id}
                name={name}
                version={candidate.version}
                description={preview?.description}
                meta={meta}
            />
            <div className={actionsCell}>
                {candidate.author && (
                    <ModFavoriteButton
                        mod={{ author: candidate.author, id: candidate.id }}
                        name={name}
                        className={favoriteButton}
                    />
                )}
                {status.kind === 'available' && (
                    <button
                        type="button"
                        onClick={onAdd}
                        disabled={disabled}
                        aria-label={`${name} を追加`}
                        className={editorButton({ intent: 'primary', size: 'sm' })}
                    >
                        {busy ? '確認中…' : '追加'}
                    </button>
                )}
                {status.kind === 'installed' &&
                    (status.outdated ? (
                        <button
                            type="button"
                            onClick={onAdd}
                            disabled={disabled}
                            aria-label={`${name} を v${candidate.version} に更新`}
                            className={editorButton({ size: 'sm' })}
                        >
                            {busy ? '確認中…' : '更新'}
                        </button>
                    ) : (
                        <span className={installedBadge}>
                            <HudIcon name="check" size={14} />
                            使用中
                        </span>
                    ))}
                {status.kind === 'conflict' && <span className={noteText}>同じ ID の mod を使用中</span>}
            </div>
        </div>
    );
}

/** 使用中の 1 行。版の変更・更新・外すはその場で反映する。 */
export function InstalledRow({
    mod,
    locked,
    checked,
    busyKey,
    disabled,
    onCheck,
    onVersion,
    onRemove,
}: {
    mod: InstalledMod;
    locked?: ModLockEntry;
    checked: boolean;
    /** 確かめている操作（この行のものならボタンに出す） */
    busyKey: string | null;
    disabled: boolean;
    onCheck: (checked: boolean) => void;
    onVersion: (version: string) => void;
    onRemove: () => void;
}) {
    const id = useId();
    const { dependency, version, candidate } = mod;
    const target = { id: dependency.name, baseUrl: dependency.source.url };
    const preview = useModPreview(version ? { ...target, version } : undefined, locked);
    const name = preview?.name ?? candidate?.name ?? dependency.name;
    const author = dependency.source.author;
    const busyHere = busyKey === `version:${dependency.name}`;
    return (
        <div className={cx(row, checked && checkedRow)}>
            <div className={checkCell}>
                <SelectBox id={id} checked={checked} label={`${name} を選ぶ`} onChange={onCheck} />
            </div>
            <div className={thumbCell}>
                <ModThumbnail image={preview?.thumbnail} size={40} />
            </div>
            <ModInfo
                labelFor={id}
                name={name}
                description={preview?.description}
                meta={sourceLabel({ id: dependency.name, name, baseUrl: dependency.source.url, author })}
            >
                {version && <ModAuthor target={target} version={version} />}
            </ModInfo>
            <div className={actionsCell}>
                {author && (
                    <ModFavoriteButton mod={{ author, id: dependency.name }} name={name} className={favoriteButton} />
                )}
                {mod.versions.length > 1 && version ? (
                    <select
                        aria-label={`${name} の版`}
                        value={version}
                        disabled={disabled}
                        onChange={(e) => onVersion(e.target.value)}
                        className={versionSelect}
                    >
                        {mod.versions.map((v) => (
                            <option key={v} value={v}>
                                v{v}
                            </option>
                        ))}
                    </select>
                ) : (
                    <span className={noteText}>{version ? `v${version}` : '最新版'}</span>
                )}
                {mod.outdated && candidate && (
                    <button
                        type="button"
                        onClick={() => onVersion(candidate.version)}
                        disabled={disabled}
                        aria-label={`${name} を v${candidate.version} に更新`}
                        className={editorButton({ size: 'sm' })}
                    >
                        {busyHere ? '確認中…' : '更新'}
                    </button>
                )}
                <button
                    type="button"
                    onClick={onRemove}
                    disabled={disabled}
                    aria-label={`${name} を外す`}
                    className={editorButton({ intent: 'icon', size: 'sm' })}
                >
                    外す
                </button>
            </div>
        </div>
    );
}

/** お気に入りのうち、作者のカタログでいま引けない mod（公開をやめた・作者のサーバーに届かない）。星で外せる。 */
export function UnavailableFavoriteRow({ mod }: { mod: ModFavoriteRef }) {
    const ref = formatPackageRef(mod);
    return (
        <div className={row}>
            <div className={checkCell} />
            <div className={thumbCell}>
                <ModThumbnail image={undefined} size={40} />
            </div>
            <div className={cx(infoCell, css({ cursor: 'default' }))}>
                <span className={nameText}>{mod.id}</span>
                <span className={cx(metaText, css({ display: 'block' }))}>{ref} · いま確認できません</span>
            </div>
            <div className={actionsCell}>
                <ModFavoriteButton mod={mod} className={favoriteButton} />
            </div>
        </div>
    );
}

/** ubichill の版。mod と同じく固定し、上げるのは作者が選んだときだけ（下げる選択肢は出さない）。 */
export function UbichillRow({
    pinned,
    disabled,
    onChange,
}: {
    pinned: number;
    disabled: boolean;
    onChange: (protocol: number) => void;
}) {
    return (
        <div className={row}>
            <div className={checkCell} />
            <div className={thumbCell}>
                <img src="/icon.png" alt="" width={40} height={40} className={css({ borderRadius: '4px' })} />
            </div>
            <div className={cx(infoCell, css({ cursor: 'default' }))}>
                <span className={nameText}>ubichill</span>
                <span className={cx(metaText, css({ display: 'block' }))}>本体の機能の版</span>
            </div>
            <div className={actionsCell}>
                <select
                    aria-label="ubichill の版"
                    value={pinned}
                    disabled={disabled}
                    onChange={(e) => onChange(Number(e.target.value))}
                    className={versionSelect}
                >
                    {selectableProtocolVersions(pinned).map((version) => (
                        <option key={version} value={version}>
                            v{version}
                        </option>
                    ))}
                </select>
                {pinned < PROTOCOL_VERSION && (
                    <button
                        type="button"
                        onClick={() => onChange(PROTOCOL_VERSION)}
                        disabled={disabled}
                        className={editorButton({ size: 'sm' })}
                    >
                        v{PROTOCOL_VERSION} に更新
                    </button>
                )}
            </div>
        </div>
    );
}

const authorLine = css({ fontSize: '11px', mt: '2px', overflowWrap: 'anywhere', lineHeight: '1.5' });

/**
 * 使っている版の作者（署名で確認できたものだけ）。確認できない版は、本番の Host では実行されない。
 * 「署名が無い」「署名が通らない」「いまは確認できない」を分けて出す。
 */
function ModAuthor({ target, version }: { target: { id: string; baseUrl?: string }; version: string }) {
    const { state, retry } = useModAuthor(target, version);
    if (state.status === 'data-only') return null;
    if (state.status === 'checking')
        return (
            <div className={cx(authorLine, css({ color: 'textSubtle' }))} role="status">
                作者を確認中…
            </div>
        );
    if (state.status === 'verified')
        return (
            <div className={cx(authorLine, css({ color: 'textSubtle' }))}>
                作者 {displayAuthorAccount(state.author)}
            </div>
        );
    if (state.status === 'unavailable')
        return (
            <div
                className={cx(
                    authorLine,
                    css({ color: 'textSubtle', display: 'flex', alignItems: 'center', gap: '6px' }),
                )}
            >
                <span>作者をいま確認できません</span>
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
                    onClick={retry}
                >
                    再確認
                </button>
            </div>
        );
    return (
        <div className={cx(authorLine, css({ color: 'errorText' }))}>
            {state.status === 'unsigned' ? '作者の署名がありません' : describeModRejection(state.reason).message}
        </div>
    );
}
