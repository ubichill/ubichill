import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/styled-system/css';

interface EditorHeaderProps {
    title: string;
    isEdit: boolean;
    saving: boolean;
    /** 編集中で未保存の変更があるか。true の間は「インスタンス作成」ボタンを出さない */
    dirty: boolean;
    onOpenInfo: () => void;
    onOpenYaml: () => void;
    onSave: () => void;
    onDelete?: () => void;
    /** 編集モードかつ未変更時に有効。クリックでこのワールドの新インスタンスを作成して参加する */
    onCreateInstance?: () => void;
}

/**
 * エディタ画面のトップバー。
 * Unity 風: 左に戻る・タイトル、右にアクション群。
 */
export function EditorHeader({
    title,
    isEdit,
    saving,
    dirty,
    onOpenInfo,
    onOpenYaml,
    onSave,
    onDelete,
    onCreateInstance,
}: EditorHeaderProps) {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);

    const closeMenu = useCallback(() => {
        setMenuOpen(false);
    }, []);

    const runMenuAction = useCallback((action: () => void) => {
        setMenuOpen(false);
        action();
    }, []);

    const saveLabel = saving ? '保存中...' : isEdit ? '保存' : '作成';
    const saveDisabled = saving || (isEdit && !dirty);

    return (
        <header
            className={css({
                gridArea: 'header',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                bg: 'surfaceAccent',
                borderBottom: '1px solid',
                borderColor: 'border',
                minH: '52px',
            })}
        >
            <IconButton onClick={() => navigate(-1)} ariaLabel="戻る" tooltip="戻る">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                </svg>
            </IconButton>
            <div
                className={css({
                    fontSize: '15px',
                    fontWeight: '700',
                    color: 'text',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minW: 0,
                })}
            >
                {title}
            </div>
            <div
                className={css({
                    display: { base: 'none', md: 'inline-flex' },
                    alignItems: 'center',
                    gap: '8px',
                })}
            >
                <SecondaryButton onClick={onOpenInfo}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4M12 8h.01" />
                    </svg>
                    ワールド情報
                </SecondaryButton>
                <SecondaryButton onClick={onOpenYaml}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                    </svg>
                    YAML
                </SecondaryButton>
                {isEdit && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={saving}
                        className={css({
                            padding: '8px 14px',
                            bg: 'errorBg',
                            color: 'errorText',
                            border: '1px solid',
                            borderColor: 'errorLight',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer',
                            _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                            _hover: { opacity: 0.9 },
                        })}
                    >
                        削除
                    </button>
                )}
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saveDisabled}
                    title={isEdit && !dirty ? '未変更' : undefined}
                    className={css({
                        padding: '8px 16px',
                        bg: 'primary',
                        color: 'textOnPrimary',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '13px',
                        fontWeight: '600',
                        cursor: 'pointer',
                        _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                        _hover: { opacity: 0.9 },
                    })}
                >
                    {saveLabel}
                </button>
                {isEdit && !dirty && onCreateInstance && (
                    <button
                        type="button"
                        onClick={onCreateInstance}
                        disabled={saving}
                        title="このワールドで新しいインスタンスを作って参加する"
                        className={css({
                            padding: '8px 14px',
                            bg: 'success',
                            color: 'text',
                            border: '1px solid',
                            borderColor: 'success',
                            borderRadius: '8px',
                            fontSize: '13px',
                            fontWeight: '700',
                            cursor: 'pointer',
                            _disabled: { opacity: 0.5, cursor: 'not-allowed' },
                            _hover: { opacity: 0.9 },
                        })}
                    >
                        ▶ インスタンス作成
                    </button>
                )}
            </div>
            <div
                className={css({
                    display: { base: 'inline-flex', md: 'none' },
                    position: 'relative',
                })}
            >
                <IconButton
                    onClick={() => setMenuOpen((prev) => !prev)}
                    ariaLabel="操作メニュー"
                    tooltip="操作メニュー"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M4 12h16M4 6h16M4 18h16" />
                    </svg>
                </IconButton>
                {menuOpen && (
                    <div
                        className={css({
                            position: 'absolute',
                            top: '42px',
                            right: 0,
                            minW: '180px',
                            padding: '6px',
                            bg: 'surface',
                            border: '1px solid',
                            borderColor: 'borderStrong',
                            borderRadius: '10px',
                            boxShadow: '0 10px 24px rgba(0,0,0,0.2)',
                            zIndex: 20,
                        })}
                    >
                        <MenuButton onClick={() => runMenuAction(onOpenInfo)}>ワールド情報</MenuButton>
                        <MenuButton onClick={() => runMenuAction(onOpenYaml)}>YAML</MenuButton>
                        {isEdit && onDelete && (
                            <MenuButton onClick={() => runMenuAction(onDelete)} danger disabled={saving}>
                                削除
                            </MenuButton>
                        )}
                        <MenuButton
                            onClick={() => runMenuAction(onSave)}
                            primary
                            disabled={saveDisabled}
                            title={isEdit && !dirty ? '未変更' : undefined}
                        >
                            {saveLabel}
                        </MenuButton>
                        {isEdit && !dirty && onCreateInstance && (
                            <MenuButton
                                onClick={() => runMenuAction(onCreateInstance)}
                                disabled={saving}
                                title="このワールドで新しいインスタンスを作って参加する"
                            >
                                インスタンス作成
                            </MenuButton>
                        )}
                        <MenuDivider />
                        <MenuButton onClick={closeMenu}>閉じる</MenuButton>
                    </div>
                )}
            </div>
        </header>
    );
}

function IconButton({
    onClick,
    ariaLabel,
    tooltip,
    children,
}: {
    onClick: () => void;
    ariaLabel: string;
    tooltip?: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={ariaLabel}
            title={tooltip}
            className={css({
                width: '32px',
                height: '32px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                bg: 'surface',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                color: 'textMuted',
                cursor: 'pointer',
                _hover: { borderColor: 'borderStrong' },
            })}
        >
            {children}
        </button>
    );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={css({
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 12px',
                bg: 'surface',
                color: 'text',
                border: '1px solid',
                borderColor: 'border',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                _hover: { borderColor: 'primary' },
            })}
        >
            {children}
        </button>
    );
}

function MenuButton({
    onClick,
    children,
    disabled,
    title,
    danger,
    primary,
}: {
    onClick: () => void;
    children: React.ReactNode;
    disabled?: boolean;
    title?: string;
    danger?: boolean;
    primary?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title}
            className={css({
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: '600',
                color: danger ? 'errorText' : primary ? 'textOnPrimary' : 'text',
                bg: danger ? 'errorBg' : primary ? 'primary' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                _hover: {
                    bg: danger ? 'errorLight' : primary ? 'primary' : 'surfaceAccent',
                },
                _disabled: { opacity: 0.5, cursor: 'not-allowed' },
            })}
        >
            {children}
        </button>
    );
}

function MenuDivider() {
    return (
        <div
            className={css({
                height: '1px',
                bg: 'border',
                margin: '6px 2px',
            })}
        />
    );
}
