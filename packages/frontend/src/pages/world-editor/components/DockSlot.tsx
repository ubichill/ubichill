import { css } from '@/styled-system/css';

interface DockSlotProps {
    /** デスクトップ時に grid 内で配置する gridArea 名 */
    area: 'left' | 'right' | 'bottom';
    /** モバイル時の表示状態。bottom は無視され常時 grid 内に表示される。 */
    mobileVisible: boolean;
    /** モバイル時の drawer ヘッダーに出すラベル（left/right のみ） */
    mobileTitle?: string;
    onMobileClose?: () => void;
    children: React.ReactNode;
}

/**
 * エディタ画面の各ドック（左/右/下）の共通ラッパー。
 *
 * - md 以上: 常にグリッドの該当セルに配置
 * - md 未満:
 *   - `bottom` は引き続きグリッド内で表示（プレビュー下の常設トレイ）
 *   - `left` / `right` は左右からスライドする drawer。`mobileVisible=false` の間は隠す。
 */
export function DockSlot({ area, mobileVisible, mobileTitle, onMobileClose, children }: DockSlotProps) {
    const isBottom = area === 'bottom';

    if (isBottom) {
        // bottom はモバイルでも常に grid 内（drawer 化しない）。
        // プレビューより前面に出すため position+zIndex を明示。
        return (
            <div
                className={css({
                    gridArea: 'bottom',
                    bg: 'surface',
                    position: 'relative',
                    zIndex: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    minH: 0,
                    minW: 0,
                })}
            >
                {children}
            </div>
        );
    }

    // left / right はモバイル時 drawer
    const isLeft = area === 'left';
    return (
        <div
            className={css({
                gridArea: { md: area },
                position: { base: 'fixed', md: 'relative' },
                top: { base: '52px', md: 'auto' }, // header (52px) を避ける
                bottom: { base: '140px', md: 'auto' }, // assets トレイ (140px) を避ける
                left: { base: isLeft ? 0 : 'auto', md: 'auto' },
                right: { base: isLeft ? 'auto' : 0, md: 'auto' },
                width: { base: '85vw', md: 'auto' },
                maxWidth: { base: '320px', md: 'none' },
                // プレビュー側のスタッキングコンテキストより前面に出す。
                // モバイル drawer はさらに高めにして、bottom トレイ (10) も上書き可能に。
                zIndex: { base: 80, md: 10 },
                display: { base: mobileVisible ? 'flex' : 'none', md: 'flex' },
                flexDirection: 'column',
                bg: 'surface',
                overflow: 'hidden',
                boxShadow: {
                    base: isLeft ? '4px 0 16px rgba(0,0,0,0.2)' : '-4px 0 16px rgba(0,0,0,0.2)',
                    md: 'none',
                },
            })}
        >
            {/* mobile only: drawer header (close button) */}
            {mobileTitle && (
                <div
                    className={css({
                        display: { base: 'flex', md: 'none' },
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        borderBottom: '1px solid',
                        borderColor: 'border',
                        flexShrink: 0,
                        bg: 'surfaceAccent',
                    })}
                >
                    <span className={css({ fontSize: '13px', fontWeight: '700', color: 'text' })}>{mobileTitle}</span>
                    {onMobileClose && (
                        <button
                            type="button"
                            onClick={onMobileClose}
                            aria-label="閉じる"
                            className={css({
                                width: '28px',
                                height: '28px',
                                borderRadius: '6px',
                                border: 'none',
                                bg: 'transparent',
                                color: 'textMuted',
                                cursor: 'pointer',
                                fontSize: '18px',
                                lineHeight: '1',
                                _hover: { bg: 'surfaceHover' },
                            })}
                        >
                            ×
                        </button>
                    )}
                </div>
            )}
            {/* スクロール領域: 中身がはみ出してもパネル内で縦スクロール可能にする */}
            <div className={css({ flex: 1, minH: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' })}>
                {children}
            </div>
        </div>
    );
}
