/**
 * pen:tray Worker — ペン置き場。
 *
 * **責務は最小: ペンを置ける場所 (背景パネル) の提供だけ**。
 *  - ペンの選択 / 持ち上げ / 線の太さ設定は pen.worker 側 (= ペン自身)
 *  - tray はペンの状態を一切知らない。視覚的な「ホルダー」を出すだけ
 */

const renderTray = (): void => {
    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'absolute',
                    inset: '0',
                    backgroundColor: 'rgba(245,245,247,0.92)',
                    borderRadius: '12px',
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    userSelect: 'none',
                    pointerEvents: 'none',
                }}
            />
        ),
        'pen-tray',
    );
};

renderTray();
