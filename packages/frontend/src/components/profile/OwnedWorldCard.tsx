import type { WorldIdentity } from '@ubichill/shared';
import { useEffect, useState } from 'react';
import { WorldIdentityBadge } from '@/components/lobby/WorldIdentityBadge';
import { css } from '@/styled-system/css';

/** プロフィール・設定のワールド一覧の 1 件。 */
export interface OwnedWorld {
    id: string;
    displayName: string;
    description: string | null;
    thumbnail: string | null;
    version: string;
    capacity: { default: number; max: number };
    updatedAt?: string;
    /** 本人の一覧のみ。署名なしは非公開なので「署名して公開」を出す。 */
    identity?: WorldIdentity;
    /** リポジトリ（worlds/）で管理している公式ワールド。画面からは編集・削除できない（変更は PR で行う）。 */
    managedBy?: 'repository';
    /** 本人の一覧のみ。配信できない理由（署名が内容と一致しないなど）。編集して公開し直すと直る。 */
    problem?: string;
}

/** ワールドのカード。`editable` なら編集・署名・削除のメニューを出す（設定のワールド管理）。 */
export function OwnedWorldCard({
    world,
    editable,
    onEdit,
    onOpen,
    onDelete,
    onSign,
}: {
    world: OwnedWorld;
    editable: boolean;
    onEdit: () => void;
    onOpen: () => void;
    onDelete?: () => void;
    onSign?: () => Promise<void>;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [signing, setSigning] = useState(false);

    // メニュー外クリックで閉じる
    useEffect(() => {
        if (!menuOpen) return;
        const close = () => setMenuOpen(false);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [menuOpen]);

    return (
        <div
            className={css({
                display: 'flex',
                flexDirection: 'column',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '14px',
                overflow: 'hidden',
                transition: 'border-color 0.16s ease',
                position: 'relative',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            {onDelete && (
                <div
                    className={css({
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        zIndex: 1,
                    })}
                >
                    <button
                        type="button"
                        aria-label="メニュー"
                        title="メニュー"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen((p) => !p);
                        }}
                        className={css({
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bg: 'rgba(0,0,0,0.45)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            _hover: { bg: 'rgba(0,0,0,0.6)' },
                        })}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                        </svg>
                    </button>
                    {menuOpen && (
                        <div
                            className={css({
                                position: 'absolute',
                                top: '34px',
                                right: '0',
                                minWidth: '120px',
                                bg: 'surface',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                                overflow: 'hidden',
                            })}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setMenuOpen(false);
                                    onDelete();
                                }}
                                className={css({
                                    width: '100%',
                                    padding: '8px 12px',
                                    bg: 'transparent',
                                    border: 'none',
                                    color: 'errorText',
                                    fontSize: '13px',
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    _hover: { bg: 'errorBg' },
                                })}
                            >
                                削除
                            </button>
                        </div>
                    )}
                </div>
            )}
            <button
                type="button"
                onClick={onOpen}
                className={css({
                    display: 'block',
                    width: '100%',
                    height: '100px',
                    bg: 'secondary',
                    border: 'none',
                    p: 0,
                    cursor: 'pointer',
                    overflow: 'hidden',
                })}
            >
                {world.thumbnail ? (
                    <img
                        src={world.thumbnail}
                        alt={world.displayName}
                        className={css({ width: '100%', height: '100%', objectFit: 'cover' })}
                    />
                ) : (
                    <div
                        className={css({
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'textSubtle',
                        })}
                    >
                        <svg
                            width="32"
                            height="32"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                    </div>
                )}
            </button>
            <div className={css({ p: '3', display: 'flex', flexDirection: 'column', gap: '2', flex: 1 })}>
                <h3 className={css({ fontSize: '15px', fontWeight: '600', color: 'text' })}>{world.displayName}</h3>
                {world.description && (
                    <p
                        className={css({
                            fontSize: '12px',
                            color: 'textMuted',
                            lineHeight: '1.4',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            overflow: 'hidden',
                        })}
                        style={{ WebkitBoxOrient: 'vertical' }}
                    >
                        {world.description}
                    </p>
                )}
                <div
                    className={css({ display: 'flex', gap: '8px', fontSize: '11px', color: 'textSubtle', mt: 'auto' })}
                >
                    <span>
                        {world.capacity.default}〜{world.capacity.max}人
                    </span>
                    <span>v{world.version}</span>
                    {editable && <WorldIdentityBadge identity={world.identity} />}
                </div>
                {editable && world.problem && (
                    <p className={css({ fontSize: '11px', color: 'errorText', lineHeight: '1.4' })}>
                        {world.problem}。編集して公開し直してください
                    </p>
                )}
                {editable && !onSign && world.identity?.status === 'verified' && !world.identity.author && (
                    <p className={css({ fontSize: '11px', color: 'textMuted', lineHeight: '1.4' })}>
                        作者を確認できない鍵（取り消し済みなど）で署名されているため、一覧に公開されていません。上の「公開」欄から署名し直せます
                    </p>
                )}
                {onSign && (
                    <div className={css({ display: 'flex', flexDirection: 'column', gap: '1' })}>
                        <p className={css({ fontSize: '11px', color: 'textMuted', lineHeight: '1.4' })}>
                            署名がないため一覧に公開されていません
                        </p>
                        <button
                            type="button"
                            disabled={signing}
                            onClick={async () => {
                                setSigning(true);
                                await onSign();
                                setSigning(false);
                            }}
                            className={css({
                                padding: '6px 12px',
                                bg: 'surface',
                                color: 'text',
                                border: '1px solid',
                                borderColor: 'border',
                                borderRadius: '8px',
                                fontSize: '12px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                _hover: { bg: 'surfaceHover' },
                                _disabled: { opacity: 0.4, cursor: 'not-allowed' },
                            })}
                        >
                            {signing ? '署名中…' : '署名して公開'}
                        </button>
                    </div>
                )}
                {editable && (
                    <button
                        type="button"
                        onClick={onEdit}
                        className={css({
                            mt: '2',
                            padding: '6px 12px',
                            bg: 'primary',
                            color: 'textOnPrimary',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            _hover: { opacity: 0.9 },
                        })}
                    >
                        編集
                    </button>
                )}
            </div>
        </div>
    );
}
