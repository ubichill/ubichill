'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './RadialMenu.module.css';

export interface RadialMenuItem {
    id: string;
    label: string;
    icon: string;
    action?: () => void;
    submenu?: RadialMenuItem[];
}

export interface RadialMenuProps {
    position: { x: number; y: number };
    items: RadialMenuItem[];
    onClose: () => void;
    centerLabel?: string;
}

export const RadialMenu: React.FC<RadialMenuProps> = ({ position, items, onClose, centerLabel = '✕' }) => {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [currentItems, setCurrentItems] = useState(items);
    const [history, setHistory] = useState<RadialMenuItem[][]>([]);
    const [isAnimating, setIsAnimating] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // 最大6個のアイテムに制限
    const displayItems = currentItems.slice(0, 6);
    const angleStep = (2 * Math.PI) / displayItems.length;
    const outerRadius = 120; // 外側の半径
    const innerRadius = 60; // 内側の半径（ドーナッツの穴）
    const centerRadius = 40; // 中央ボタンの半径

    useEffect(() => {
        setIsAnimating(true);
        const timer = setTimeout(() => setIsAnimating(false), 300);
        return () => clearTimeout(timer);
    }, [currentItems]);

    // 扇形のSVGパスを生成
    const createSegmentPath = (index: number): string => {
        const startAngle = -Math.PI / 2 + index * angleStep;
        const endAngle = startAngle + angleStep;

        const x1 = Math.cos(startAngle) * innerRadius;
        const y1 = Math.sin(startAngle) * innerRadius;
        const x2 = Math.cos(startAngle) * outerRadius;
        const y2 = Math.sin(startAngle) * outerRadius;
        const x3 = Math.cos(endAngle) * outerRadius;
        const y3 = Math.sin(endAngle) * outerRadius;
        const x4 = Math.cos(endAngle) * innerRadius;
        const y4 = Math.sin(endAngle) * innerRadius;

        const largeArcFlag = angleStep > Math.PI ? 1 : 0;

        return `
            M ${x1} ${y1}
            L ${x2} ${y2}
            A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${x3} ${y3}
            L ${x4} ${y4}
            A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${x1} ${y1}
            Z
        `;
    };

    // マウス位置から選択されているセグメントを計算
    const getSegmentFromPoint = (clientX: number, clientY: number): number | null => {
        if (!menuRef.current) return null;

        const rect = menuRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        const dx = clientX - centerX;
        const dy = clientY - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 中央ボタンまたはドーナッツの外側の場合は選択なし
        if (distance < innerRadius || distance > outerRadius) {
            return null;
        }

        // 角度を計算 (-PI/2が上、時計回り)
        let angle = Math.atan2(dy, dx);
        angle = angle + Math.PI / 2; // 上を0度にする
        if (angle < 0) angle += 2 * Math.PI;

        const segmentIndex = Math.floor(angle / angleStep);
        return segmentIndex < displayItems.length ? segmentIndex : null;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const segment = getSegmentFromPoint(e.clientX, e.clientY);
        setSelectedIndex(segment);
    };

    const handleClick = (e: React.MouseEvent) => {
        const segment = getSegmentFromPoint(e.clientX, e.clientY);

        if (segment !== null && displayItems[segment]) {
            const item = displayItems[segment];
            handleItemClick(item);
        }
    };

    const handleItemClick = (item: RadialMenuItem) => {
        if (item.submenu) {
            // サブメニューを開く
            setHistory([...history, currentItems]);
            setCurrentItems(item.submenu);
        } else if (item.action) {
            // アクションを実行して閉じる
            item.action();
            onClose();
        }
    };

    const handleCenterClick = () => {
        if (history.length > 0) {
            // 戻る
            const previous = history[history.length - 1];
            setHistory(history.slice(0, -1));
            setCurrentItems(previous);
        } else {
            // 閉じる
            onClose();
        }
    };

    const handleClickOutside = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    // 各セグメントのアイコンとラベルの位置を計算
    const getItemPosition = (index: number) => {
        const midAngle = -Math.PI / 2 + index * angleStep + angleStep / 2;
        const labelRadius = (innerRadius + outerRadius) / 2;
        return {
            x: Math.cos(midAngle) * labelRadius,
            y: Math.sin(midAngle) * labelRadius,
        };
    };

    return (
        <div className={styles.overlay} onClick={handleClickOutside}>
            <div
                ref={menuRef}
                className={`${styles.menu} ${isAnimating ? styles.animating : ''}`}
                style={{
                    left: position.x,
                    top: position.y,
                }}
                onMouseMove={handleMouseMove}
                onClick={handleClick}
            >
                <svg
                    className={styles.menuSvg}
                    viewBox={`${-outerRadius - 10} ${-outerRadius - 10} ${(outerRadius + 10) * 2} ${(outerRadius + 10) * 2}`}
                    style={{ width: (outerRadius + 10) * 2, height: (outerRadius + 10) * 2 }}
                >
                    {/* 扇形セグメント */}
                    {displayItems.map((item, index) => (
                        <path
                            key={item.id}
                            className={`${styles.segment} ${selectedIndex === index ? styles.selectedSegment : ''}`}
                            d={createSegmentPath(index)}
                            style={{
                                transitionDelay: `${index * 30}ms`,
                            }}
                        />
                    ))}

                    {/* 中央の円 */}
                    <circle
                        className={`${styles.centerCircle} ${history.length > 0 ? styles.backButton : ''}`}
                        r={centerRadius}
                        cx={0}
                        cy={0}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleCenterClick();
                        }}
                    />
                </svg>

                {/* アイコンとラベル（SVGの上に描画） */}
                {displayItems.map((item, index) => {
                    const pos = getItemPosition(index);
                    return (
                        <div
                            key={`label-${item.id}`}
                            className={`${styles.itemLabel} ${selectedIndex === index ? styles.selectedLabel : ''}`}
                            style={{
                                transform: `translate(${pos.x}px, ${pos.y}px)`,
                                transitionDelay: `${index * 30}ms`,
                            }}
                        >
                            <span className={styles.icon}>{item.icon}</span>
                            <span className={styles.label}>{item.label}</span>
                            {item.submenu && <span className={styles.arrow}>›</span>}
                        </div>
                    );
                })}

                {/* 中央のラベル */}
                <div className={styles.centerLabel}>
                    <span className={styles.centerIcon}>{history.length > 0 ? '↩' : centerLabel}</span>
                </div>
            </div>
        </div>
    );
};
