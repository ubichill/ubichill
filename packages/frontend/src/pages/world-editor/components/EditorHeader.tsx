import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/styled-system/css';
import { editorButton } from '../recipes/button';

interface EditorHeaderProps {
    title: string;
    isEdit: boolean;
    saving: boolean;
    /** 編集中で未保存の変更があるか。true の間は「インスタンス作成」ボタンを出さない */
    dirty: boolean;
    /** ON のときドラッグ / リサイズをグリッド + ワールド範囲で snap/clamp する */
    snapEnabled: boolean;
    onToggleSnap: () => void;
    onOpenInfo: () => void;
    onOpenYaml: () => void;
    onSave: () => void;
    onDelete?: () => void;
    /** 編集モードかつ未変更時に有効。クリックでこのワールドの新インスタンスを作成して参加する */
    onCreateInstance?: () => void;
}

/** エディタ画面のトップバー。Unity 風: 左に戻る・タイトル、右にアクション群。 */
export function EditorHeader({
    title,
    isEdit,
    saving,
    dirty,
    snapEnabled,
    onToggleSnap,
    onOpenInfo,
    onOpenYaml,
    onSave,
    onDelete,
    onCreateInstance,
}: EditorHeaderProps) {
    const navigate = useNavigate();
    const [menuOpen, setMenuOpen] = useState(false);

    const closeMenu = useCallback(() => setMenuOpen(false), []);
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
            <button
                type="button"
                onClick={() => navigate(-1)}
                aria-label="戻る"
                title="戻る"
                className={editorButton({ intent: 'icon', size: 'iconSm' })}
            >
                <BackIcon />
            </button>
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
                <button
                    type="button"
                    onClick={onToggleSnap}
                    title="ON: ワールド範囲に収まるようにグリッドへスナップ"
                    aria-pressed={snapEnabled}
                    className={editorButton({ intent: snapEnabled ? 'toggleOn' : 'secondary' })}
                >
                    <GridIcon />
                    スナップ
                </button>
                <button type="button" onClick={onOpenInfo} className={editorButton({ intent: 'secondary' })}>
                    <InfoIcon />
                    ワールド情報
                </button>
                <button type="button" onClick={onOpenYaml} className={editorButton({ intent: 'secondary' })}>
                    <FileIcon />
                    YAML
                </button>
                {isEdit && onDelete && (
                    <button
                        type="button"
                        onClick={onDelete}
                        disabled={saving}
                        className={editorButton({ intent: 'danger' })}
                    >
                        削除
                    </button>
                )}
                <button
                    type="button"
                    onClick={onSave}
                    disabled={saveDisabled}
                    title={isEdit && !dirty ? '未変更' : undefined}
                    className={editorButton({ intent: 'primary', size: 'lg' })}
                >
                    {saveLabel}
                </button>
                {isEdit && !dirty && onCreateInstance && (
                    <button
                        type="button"
                        onClick={onCreateInstance}
                        disabled={saving}
                        title="このワールドで新しいインスタンスを作って参加する"
                        className={editorButton({ intent: 'success' })}
                    >
                        ▶ インスタンス作成
                    </button>
                )}
            </div>
            <div className={css({ display: { base: 'inline-flex', md: 'none' }, position: 'relative' })}>
                <button
                    type="button"
                    onClick={() => setMenuOpen((prev) => !prev)}
                    aria-label="操作メニュー"
                    title="操作メニュー"
                    className={editorButton({ intent: 'icon', size: 'iconSm' })}
                >
                    <HamburgerIcon />
                </button>
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
                            boxShadow: 'card',
                            zIndex: 20,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '2px',
                        })}
                    >
                        <button
                            type="button"
                            onClick={() => runMenuAction(onToggleSnap)}
                            className={editorButton({ intent: 'menu', size: 'menu' })}
                        >
                            スナップ: {snapEnabled ? 'ON' : 'OFF'}
                        </button>
                        <button
                            type="button"
                            onClick={() => runMenuAction(onOpenInfo)}
                            className={editorButton({ intent: 'menu', size: 'menu' })}
                        >
                            ワールド情報
                        </button>
                        <button
                            type="button"
                            onClick={() => runMenuAction(onOpenYaml)}
                            className={editorButton({ intent: 'menu', size: 'menu' })}
                        >
                            YAML
                        </button>
                        {isEdit && onDelete && (
                            <button
                                type="button"
                                onClick={() => runMenuAction(onDelete)}
                                disabled={saving}
                                className={editorButton({ intent: 'menuDanger', size: 'menu' })}
                            >
                                削除
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => runMenuAction(onSave)}
                            disabled={saveDisabled}
                            title={isEdit && !dirty ? '未変更' : undefined}
                            className={editorButton({ intent: 'menuPrimary', size: 'menu' })}
                        >
                            {saveLabel}
                        </button>
                        {isEdit && !dirty && onCreateInstance && (
                            <button
                                type="button"
                                onClick={() => runMenuAction(onCreateInstance)}
                                disabled={saving}
                                title="このワールドで新しいインスタンスを作って参加する"
                                className={editorButton({ intent: 'menu', size: 'menu' })}
                            >
                                インスタンス作成
                            </button>
                        )}
                        <div className={css({ height: '1px', bg: 'border', margin: '6px 2px' })} />
                        <button
                            type="button"
                            onClick={closeMenu}
                            className={editorButton({ intent: 'menu', size: 'menu' })}
                        >
                            閉じる
                        </button>
                    </div>
                )}
            </div>
        </header>
    );
}

// ============================================
// アイコン
// ============================================

function BackIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
        </svg>
    );
}

function GridIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18" />
        </svg>
    );
}

function InfoIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
        </svg>
    );
}

function FileIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </svg>
    );
}

function HamburgerIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12h16M4 6h16M4 18h16" />
        </svg>
    );
}
