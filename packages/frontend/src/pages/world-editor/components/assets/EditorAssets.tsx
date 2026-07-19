import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { css } from '@/styled-system/css';
import type { AvailableEntityKind } from '../../hooks/useAvailableEntityKinds';
import { type AssetNode, useModAssets } from '../../hooks/useModAssets';
import { COMPONENT_DRAG_MIME } from '../../lib/dnd';

interface EditorAssetsProps {
    kinds: AvailableEntityKind[];
    loading: boolean;
    /** YAML の dependencies で参照されているmod名一覧 */
    modNames: string[];
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const CURSOR_EXT = /\.(cur|ani|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

/** ナビゲーション位置: [] = ルート（mod一覧）、[mod, ...folder] = 中。 */
type Path = string[];

export function EditorAssets({ kinds, loading, modNames }: EditorAssetsProps) {
    const { treesByMod } = useModAssets(modNames);
    const [path, setPath] = useState<Path>([]);

    const componentsByMod = useMemo(() => {
        const map = new Map<string, AvailableEntityKind[]>();
        for (const k of kinds) {
            const arr = map.get(k.modName) ?? [];
            arr.push(k);
            map.set(k.modName, arr);
        }
        return map;
    }, [kinds]);

    // 現在表示するエントリ
    const entries = useMemo(
        () => buildEntries(path, modNames, componentsByMod, treesByMod),
        [path, modNames, componentsByMod, treesByMod],
    );

    return (
        <section
            className={css({
                bg: 'surface',
                borderTop: '1px solid',
                borderColor: 'border',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minH: 0,
                width: 'full',
                height: 'full',
            })}
        >
            <Toolbar path={path} onNavigate={setPath} loading={loading} />
            <div
                className={css({
                    flex: 1,
                    overflowY: 'auto',
                    padding: '8px',
                    minH: 0,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                    gap: '8px',
                    alignContent: 'start',
                })}
            >
                {entries.length === 0 ? (
                    <div
                        className={css({
                            gridColumn: '1 / -1',
                            fontSize: '12px',
                            color: 'textSubtle',
                            padding: '8px',
                            textAlign: 'center',
                        })}
                    >
                        {path.length === 0 && modNames.length === 0
                            ? '「ワールド情報」モーダルからmodを追加してください'
                            : '(空)'}
                    </div>
                ) : (
                    entries.map((e) => (
                        <EntryTile
                            key={e.key}
                            entry={e}
                            onOpen={() => {
                                if (e.kind === 'mod') setPath([e.name]);
                                else if (e.kind === 'folder') setPath([...path, e.name]);
                            }}
                        />
                    ))
                )}
            </div>
        </section>
    );
}

// ============================================
// ツールバー (breadcrumb + 戻る)
// ============================================

function Toolbar({ path, onNavigate, loading }: { path: Path; onNavigate: (p: Path) => void; loading: boolean }) {
    return (
        <div
            className={css({
                padding: '8px 12px',
                borderBottom: '1px solid',
                borderColor: 'border',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexShrink: 0,
                fontSize: '11px',
            })}
        >
            <button
                type="button"
                onClick={() => onNavigate(path.slice(0, -1))}
                disabled={path.length === 0}
                title="上の階層へ"
                className={css({
                    width: '24px',
                    height: '24px',
                    bg: 'transparent',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '4px',
                    color: 'textMuted',
                    cursor: 'pointer',
                    _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                    _hover: { borderColor: 'primary' },
                })}
            >
                <BackIcon />
            </button>
            <div className={css({ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minW: 0 })}>
                <Crumb label="アセット" onClick={() => onNavigate([])} active={path.length === 0} />
                {path.map((seg, i) => (
                    <Fragment key={`${seg}-${i}`}>
                        <span className={css({ color: 'textSubtle' })}>›</span>
                        <Crumb
                            label={seg}
                            active={i === path.length - 1}
                            onClick={() => onNavigate(path.slice(0, i + 1))}
                        />
                    </Fragment>
                ))}
            </div>
            {loading && <span className={css({ color: 'textSubtle' })}>読み込み中...</span>}
        </div>
    );
}

function Crumb({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={css({
                padding: '2px 6px',
                bg: 'transparent',
                border: 'none',
                color: active ? 'text' : 'textMuted',
                fontWeight: active ? '600' : '500',
                cursor: 'pointer',
                fontSize: '11px',
                borderRadius: '4px',
                _hover: { bg: 'surfaceHover' },
            })}
        >
            {label}
        </button>
    );
}

// ============================================
// エントリ構築 (現在のパスから表示候補を組み立て)
// ============================================

type Entry =
    | { kind: 'mod'; key: string; name: string }
    | { kind: 'folder'; key: string; name: string }
    | {
          kind: 'component';
          key: string;
          name: string;
          componentType: string;
          modName: string;
          thumbnailUrl?: string;
      }
    | { kind: 'file'; key: string; name: string; url: string };

function buildEntries(
    path: Path,
    modNames: string[],
    componentsByMod: Map<string, AvailableEntityKind[]>,
    treesByMod: Map<string, AssetNode[]>,
): Entry[] {
    if (path.length === 0) {
        return modNames.map((p) => ({ kind: 'mod', key: `mod:${p}`, name: p }));
    }
    const [modName, ...rest] = path;
    // mod直下: Components フォルダ + Files フォルダ (実体があるときのみ)
    if (rest.length === 0) {
        const comps = componentsByMod.get(modName) ?? [];
        const tree = treesByMod.get(modName) ?? [];
        const out: Entry[] = [];
        if (comps.length > 0) out.push({ kind: 'folder', key: 'folder:Components', name: 'Components' });
        if (tree.length > 0) out.push({ kind: 'folder', key: 'folder:Files', name: 'Files' });
        return out;
    }
    if (rest[0] === 'Components') {
        const comps = componentsByMod.get(modName) ?? [];
        return comps.map((c) => ({
            kind: 'component',
            key: `comp:${c.kind}`,
            name: c.kind.split(':').slice(1).join(':') || c.kind,
            componentType: c.kind,
            modName,
            thumbnailUrl: c.thumbnailUrl,
        }));
    }
    if (rest[0] === 'Files') {
        // path = [mod, "Files", folder1, folder2, ...]
        const folderPath = rest.slice(1);
        const tree = treesByMod.get(modName) ?? [];
        const node = walkTree(tree, folderPath);
        if (!node) return [];
        return node.map((n) =>
            n.kind === 'folder'
                ? { kind: 'folder', key: `folder:${n.name}`, name: n.name }
                : { kind: 'file', key: `file:${n.path}`, name: n.name, url: n.url },
        );
    }
    return [];
}

function walkTree(nodes: AssetNode[], folders: string[]): AssetNode[] | null {
    let cur: AssetNode[] = nodes;
    for (const seg of folders) {
        const next = cur.find((n) => n.kind === 'folder' && n.name === seg);
        if (next?.kind !== 'folder') return null;
        cur = next.children;
    }
    return cur;
}

// ============================================
// タイル (グリッド 1 セル)
// ============================================

function EntryTile({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
    if (entry.kind === 'mod' || entry.kind === 'folder') {
        return (
            <button
                type="button"
                onDoubleClick={onOpen}
                onClick={onOpen}
                title={entry.name}
                className={tileButtonStyle}
            >
                {entry.kind === 'mod' ? <ModFolderIcon /> : <FolderIcon />}
                <span className={tileLabelStyle}>{entry.name}</span>
            </button>
        );
    }
    if (entry.kind === 'component') {
        return (
            <div
                draggable
                onDragStart={(e) => {
                    e.dataTransfer.setData(COMPONENT_DRAG_MIME, entry.componentType);
                    e.dataTransfer.setData('text/plain', entry.componentType);
                    e.dataTransfer.effectAllowed = 'copy';
                }}
                title={`${entry.componentType} — Entity へドラッグして追加`}
                className={css({
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '6px 4px',
                    bg: 'background',
                    border: '1px solid',
                    borderColor: 'border',
                    borderRadius: '8px',
                    cursor: 'grab',
                    _active: { cursor: 'grabbing' },
                    _hover: { borderColor: 'primary' },
                })}
            >
                <ThumbBox>
                    {entry.thumbnailUrl ? (
                        <ImgWithFallback src={entry.thumbnailUrl} alt={entry.name} fallback={<ComponentIcon />} />
                    ) : (
                        <ComponentIcon />
                    )}
                </ThumbBox>
                <span className={tileLabelStyle}>{entry.name}</span>
            </div>
        );
    }
    // file
    return (
        <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            title={entry.url}
            className={css({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 4px',
                bg: 'background',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                textDecoration: 'none',
                color: 'text',
                _hover: { borderColor: 'primary' },
            })}
        >
            <FileThumb name={entry.name} url={entry.url} />
            <span className={tileLabelStyle}>{entry.name}</span>
        </a>
    );
}

function FileThumb({ name, url }: { name: string; url: string }) {
    const isImage = IMAGE_EXT.test(name);
    const isCursor = CURSOR_EXT.test(name);
    const isVideo = VIDEO_EXT.test(name);
    return (
        <ThumbBox>
            {isImage || isCursor ? (
                // .cur / .ani / .ico は Chrome なら <img> で描画できる。失敗時は FileIcon に fallback。
                <ImgWithFallback src={url} alt={name} fallback={<FileIcon />} />
            ) : isVideo ? (
                <video
                    src={url}
                    muted
                    preload="metadata"
                    className={css({ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' })}
                >
                    <track kind="captions" />
                </video>
            ) : (
                <FileIcon />
            )}
        </ThumbBox>
    );
}

function ThumbBox({ children }: { children: ReactNode }) {
    return (
        <div
            className={css({
                width: '64px',
                height: '64px',
                bg: 'surface',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0,
            })}
        >
            {children}
        </div>
    );
}

function ImgWithFallback({ src, alt, fallback }: { src: string; alt: string; fallback: ReactNode }) {
    const [failed, setFailed] = useState(false);
    if (failed) return <>{fallback}</>;
    return (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className={css({ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' })}
        />
    );
}

// ============================================
// アイコン群
// ============================================

const tileButtonStyle = css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    padding: '8px 4px',
    bg: 'background',
    border: '1px solid',
    borderColor: 'border',
    borderRadius: '8px',
    cursor: 'pointer',
    _hover: { borderColor: 'primary' },
});

const tileLabelStyle = css({
    fontSize: '10px',
    color: 'text',
    fontWeight: '500',
    textAlign: 'center',
    width: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    padding: '0 2px',
});

function BackIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
        >
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
                d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                fill="#d4c4ab"
                stroke="#b0a48e"
                strokeWidth="1"
            />
        </svg>
    );
}

function ModFolderIcon() {
    return (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#1b2a44" />
            <path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function ComponentIcon() {
    return (
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="16" height="16" rx="2" fill="#f5ecdf" stroke="#1b2a44" strokeWidth="1.5" />
            <circle cx="9" cy="9" r="1.5" fill="#1b2a44" />
            <circle cx="15" cy="9" r="1.5" fill="#1b2a44" />
            <circle cx="9" cy="15" r="1.5" fill="#1b2a44" />
            <circle cx="15" cy="15" r="1.5" fill="#1b2a44" />
        </svg>
    );
}

function FileIcon() {
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
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
        </svg>
    );
}
