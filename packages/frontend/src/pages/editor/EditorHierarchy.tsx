import type { InitialEntity } from '@ubichill/shared';
import { css } from '@/styled-system/css';

interface EditorHierarchyProps {
    entities: InitialEntity[];
    selectedIndex: number | null;
    hiddenIndices: Set<number>;
    onSelect: (i: number | null) => void;
    onDelete: (i: number) => void;
    onToggleHidden: (i: number) => void;
}

/**
 * 左ドックの「ヒエラルキー」パネル。
 * 配置済みエンティティを縦リストで表示し、クリックで選択。
 * 各行に目アイコンで表示/非表示を切り替えできる（編集ローカル状態のみ、保存には影響しない）。
 */
export function EditorHierarchy({
    entities,
    selectedIndex,
    hiddenIndices,
    onSelect,
    onDelete,
    onToggleHidden,
}: EditorHierarchyProps) {
    return (
        <aside
            className={css({
                gridArea: 'left',
                bg: 'surface',
                borderRight: '1px solid',
                borderColor: 'border',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                minH: 0,
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
                <span>ヒエラルキー</span>
                <span className={css({ color: 'textSubtle', fontWeight: '500' })}>{entities.length}</span>
            </div>
            <div
                className={css({
                    flex: 1,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '4px',
                    minH: 0,
                    '&::-webkit-scrollbar': { width: '6px' },
                    '&::-webkit-scrollbar-thumb': { backgroundColor: 'primarySubtle', borderRadius: '3px' },
                })}
            >
                {entities.length === 0 ? (
                    <div
                        className={css({
                            padding: '12px',
                            fontSize: '12px',
                            color: 'textSubtle',
                            textAlign: 'center',
                        })}
                    >
                        まだエンティティがありません
                    </div>
                ) : (
                    entities.map((e, i) => {
                        const selected = i === selectedIndex;
                        const hidden = hiddenIndices.has(i);
                        const w = e.transform.w ?? 0;
                        const h = e.transform.h ?? 0;
                        const sizeBadge = w > 0 && h > 0 ? `${w}×${h}` : '—';
                        return (
                            <div
                                key={`${e.kind}-${i}`}
                                className={css({
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    bg: selected ? 'primary' : 'transparent',
                                    color: selected ? 'textOnPrimary' : 'text',
                                    opacity: hidden ? 0.45 : 1,
                                    _hover: { bg: selected ? 'primary' : 'surfaceHover' },
                                })}
                                onClick={() => onSelect(i)}
                            >
                                <button
                                    type="button"
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        onToggleHidden(i);
                                    }}
                                    aria-label={hidden ? '表示' : '非表示'}
                                    title={hidden ? '表示する' : '非表示にする'}
                                    className={css({
                                        flexShrink: 0,
                                        width: '22px',
                                        height: '22px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        bg: 'transparent',
                                        border: 'none',
                                        color: selected ? 'textOnPrimary' : 'textMuted',
                                        cursor: 'pointer',
                                        borderRadius: '4px',
                                        _hover: { bg: 'rgba(0,0,0,0.08)' },
                                    })}
                                >
                                    {hidden ? (
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        >
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                                            <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                                            <path d="M1 1l22 22" />
                                        </svg>
                                    ) : (
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                        >
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                            <circle cx="12" cy="12" r="3" />
                                        </svg>
                                    )}
                                </button>
                                <div
                                    className={css({
                                        flex: 1,
                                        minW: 0,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '1px',
                                    })}
                                >
                                    <span
                                        className={css({
                                            fontSize: '12px',
                                            fontWeight: '600',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            textDecoration: hidden ? 'line-through' : 'none',
                                        })}
                                    >
                                        {e.kind}
                                    </span>
                                    <span
                                        className={css({
                                            fontSize: '10px',
                                            opacity: 0.7,
                                        })}
                                    >
                                        ({Math.round(e.transform.x)}, {Math.round(e.transform.y)}) · {sizeBadge}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={(ev) => {
                                        ev.stopPropagation();
                                        onDelete(i);
                                    }}
                                    aria-label="削除"
                                    title="削除"
                                    className={css({
                                        flexShrink: 0,
                                        width: '20px',
                                        height: '20px',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        bg: 'transparent',
                                        border: 'none',
                                        color: selected ? 'textOnPrimary' : 'textSubtle',
                                        opacity: 0.7,
                                        cursor: 'pointer',
                                        borderRadius: '4px',
                                        fontSize: '14px',
                                        lineHeight: '1',
                                        _hover: { opacity: 1, bg: 'rgba(0,0,0,0.1)' },
                                    })}
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
