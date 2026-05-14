import { useMemo, useState } from 'react';
import { css } from '@/styled-system/css';
import type { AvailableEntityKind } from '../hooks/useAvailableEntityKinds';
import { type PluginAssetFile, usePluginAssets } from '../hooks/usePluginAssets';
import { COMPONENT_DRAG_MIME } from '../lib/dnd';

interface EditorAssetsProps {
    kinds: AvailableEntityKind[];
    loading: boolean;
    /** YAML の dependencies で参照されているプラグイン名一覧 */
    pluginNames: string[];
}

export function EditorAssets({ kinds, loading, pluginNames }: EditorAssetsProps) {
    const { assetsByPlugin } = usePluginAssets(pluginNames);

    const componentsByPlugin = useMemo(() => {
        const map = new Map<string, AvailableEntityKind[]>();
        for (const k of kinds) {
            const arr = map.get(k.pluginName) ?? [];
            arr.push(k);
            map.set(k.pluginName, arr);
        }
        return map;
    }, [kinds]);

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
            <div
                className={css({
                    padding: '10px 12px',
                    fontSize: '11px',
                    fontWeight: '700',
                    color: 'textMuted',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderBottom: '1px solid',
                    borderColor: 'border',
                    flexShrink: 0,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                })}
            >
                <span>アセット</span>
                {loading && <span className={css({ color: 'textSubtle', fontWeight: '500' })}>読み込み中...</span>}
            </div>
            <div
                className={css({
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '6px 8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    minH: 0,
                })}
            >
                {pluginNames.length === 0 ? (
                    <div className={css({ fontSize: '12px', color: 'textSubtle', padding: '8px' })}>
                        「ワールド情報」モーダルの「使用するプラグイン」からプラグインを追加してください
                    </div>
                ) : (
                    pluginNames.map((name) => (
                        <PluginFolder
                            key={name}
                            pluginName={name}
                            components={componentsByPlugin.get(name) ?? []}
                            assets={assetsByPlugin.get(name) ?? []}
                        />
                    ))
                )}
            </div>
        </section>
    );
}

interface PluginFolderProps {
    pluginName: string;
    components: AvailableEntityKind[];
    assets: PluginAssetFile[];
}

function PluginFolder({ pluginName, components, assets }: PluginFolderProps) {
    const [open, setOpen] = useState(true);
    const total = components.length + assets.length;
    return (
        <div className={css({ display: 'flex', flexDirection: 'column' })}>
            <button
                type="button"
                onClick={() => setOpen((p) => !p)}
                className={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 8px',
                    bg: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'text',
                    textAlign: 'left',
                    borderRadius: '4px',
                    _hover: { bg: 'surfaceHover' },
                })}
            >
                <Chevron open={open} />
                <FolderIcon />
                <span className={css({ fontSize: '13px', fontWeight: '600' })}>{pluginName}</span>
                <span className={css({ fontSize: '10px', color: 'textSubtle' })}>{total}</span>
            </button>
            {open && (
                <div className={css({ display: 'flex', flexDirection: 'column', gap: '4px', pl: '4', py: '2' })}>
                    {components.length > 0 && (
                        <Section title="Components">
                            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '6px' })}>
                                {components.map((c) => (
                                    <ComponentCard key={c.kind} kind={c} />
                                ))}
                            </div>
                        </Section>
                    )}
                    {assets.length > 0 && (
                        <Section title="Files">
                            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '6px' })}>
                                {assets.map((a) => (
                                    <AssetCard key={a.url} asset={a} />
                                ))}
                            </div>
                        </Section>
                    )}
                    {components.length === 0 && assets.length === 0 && (
                        <div className={css({ fontSize: '11px', color: 'textSubtle', pl: '6px' })}>(空)</div>
                    )}
                </div>
            )}
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
            <span
                className={css({
                    fontSize: '10px',
                    fontWeight: '700',
                    color: 'textSubtle',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    pl: '6px',
                })}
            >
                {title}
            </span>
            {children}
        </div>
    );
}

function ComponentCard({ kind }: { kind: AvailableEntityKind }) {
    const localName = kind.kind.split(':').slice(1).join(':') || kind.kind;
    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData(COMPONENT_DRAG_MIME, kind.kind);
                e.dataTransfer.setData('text/plain', kind.kind);
                e.dataTransfer.effectAllowed = 'copy';
            }}
            title={`${kind.kind} — Entity 行へドラッグして追加`}
            className={css({
                width: '120px',
                p: '8px 10px',
                bg: 'background',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                cursor: 'grab',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                _active: { cursor: 'grabbing' },
                _hover: { borderColor: 'primary' },
            })}
        >
            <div className={css({ fontSize: '13px', fontWeight: '600', color: 'text' })}>{localName}</div>
            <div className={css({ fontSize: '10px', color: 'textSubtle', fontFamily: 'mono' })}>{kind.kind}</div>
        </div>
    );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

function AssetCard({ asset }: { asset: PluginAssetFile }) {
    const isImage = IMAGE_EXT.test(asset.path);
    const isVideo = VIDEO_EXT.test(asset.path);
    return (
        <a
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            title={asset.url}
            className={css({
                width: '92px',
                p: '6px',
                bg: 'background',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                textDecoration: 'none',
                color: 'text',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                _hover: { borderColor: 'primary' },
            })}
        >
            <div
                className={css({
                    width: '100%',
                    height: '64px',
                    bg: 'surface',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                })}
            >
                {isImage ? (
                    <img
                        src={asset.url}
                        alt={asset.path}
                        className={css({ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' })}
                    />
                ) : isVideo ? (
                    <FileVideoIcon />
                ) : (
                    <FileIcon />
                )}
            </div>
            <span
                className={css({
                    fontSize: '10px',
                    color: 'textMuted',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                })}
            >
                {asset.path.split('/').pop()}
            </span>
        </a>
    );
}

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
            aria-hidden="true"
        >
            <path d="M9 18l6-6-6-6" />
        </svg>
    );
}

function FolderIcon() {
    return (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
        >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
    );
}

function FileIcon() {
    return (
        <svg
            width="22"
            height="22"
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

function FileVideoIcon() {
    return (
        <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
        >
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <path d="M10 13l4 2.5L10 18z" fill="currentColor" />
        </svg>
    );
}
