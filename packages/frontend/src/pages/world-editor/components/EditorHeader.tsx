import { useCallback, useState } from 'react';
import { css } from '@/styled-system/css';
import { editorButton } from '../recipes/button';

interface EditorHeaderProps {
    title: string;
    /** 保存されていない変更があるか。true の間はタイトルに * を表示する */
    dirty: boolean;
    /** ON のときドラッグ / リサイズをグリッド + ワールド範囲で snap/clamp する */
    snapEnabled: boolean;
    onToggleSnap: () => void;
    /** 戻るボタン押下時（未保存時は呼び出し側で確認モーダルを出す） */
    onBack: () => void;
    /** コントロールパネル（ワールド情報・mod管理・YAML）を開く。削除はコントロールパネル最下部のDanger Zoneへ移した */
    onOpenControlPanel: () => void;
}

/** エディタ画面のトップバー。Unity 風: 左に戻る・タイトル、右にアクション群。 */
export function EditorHeader({
    title,
    dirty,
    snapEnabled,
    onToggleSnap,
    onBack,
    onOpenControlPanel,
}: EditorHeaderProps) {
    const [menuOpen, setMenuOpen] = useState(false);

    const closeMenu = useCallback(() => setMenuOpen(false), []);
    const runMenuAction = useCallback((action: () => void) => {
        setMenuOpen(false);
        action();
    }, []);

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
                onClick={onBack}
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
                {dirty && (
                    <span title="未保存の変更があります" className={css({ color: 'primaryHighlight', ml: '2px' })}>
                        *
                    </span>
                )}
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
                <button
                    type="button"
                    onClick={onOpenControlPanel}
                    className={editorButton({ intent: 'primary', size: 'lg' })}
                >
                    <InfoIcon />
                    コントロールパネル
                </button>
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
                            onClick={() => runMenuAction(onOpenControlPanel)}
                            className={editorButton({ intent: 'menuPrimary', size: 'menu' })}
                        >
                            コントロールパネル
                        </button>
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

function HamburgerIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12h16M4 6h16M4 18h16" />
        </svg>
    );
}
