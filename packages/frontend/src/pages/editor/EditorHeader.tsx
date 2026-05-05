import { useNavigate } from 'react-router-dom';
import { css } from '@/styled-system/css';

interface EditorHeaderProps {
    title: string;
    isEdit: boolean;
    saving: boolean;
    yamlDirty: boolean;
    onOpenInfo: () => void;
    onOpenYaml: () => void;
    onSave: () => void;
    onDelete?: () => void;
}

/**
 * エディタ画面のトップバー。
 * Unity 風: 左に戻る・タイトル、右にアクション群。
 */
export function EditorHeader({
    title,
    isEdit,
    saving,
    yamlDirty,
    onOpenInfo,
    onOpenYaml,
    onSave,
    onDelete,
}: EditorHeaderProps) {
    const navigate = useNavigate();

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
                disabled={saving || yamlDirty}
                title={yamlDirty ? 'YAML が不正です' : undefined}
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
                {saving ? '保存中...' : isEdit ? '保存' : '作成'}
            </button>
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
