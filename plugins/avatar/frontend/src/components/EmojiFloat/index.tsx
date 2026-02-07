'use client';

import { useEffect, useState } from 'react';
import styles from './EmojiFloat.module.css';

export interface FloatingEmoji {
    id: string;
    emoji: string;
    position: { x: number; y: number };
    timestamp: number;
}

export interface EmojiFloatProps {
    emojis: FloatingEmoji[];
    onComplete: (id: string) => void;
}

export const EmojiFloat: React.FC<EmojiFloatProps> = ({ emojis, onComplete }) => {
    return (
        <div className={styles.container}>
            {emojis.map((emoji) => (
                <EmojiItem key={emoji.id} emoji={emoji} onComplete={() => onComplete(emoji.id)} />
            ))}
        </div>
    );
};

interface EmojiItemProps {
    emoji: FloatingEmoji;
    onComplete: () => void;
}

const EmojiItem: React.FC<EmojiItemProps> = ({ emoji, onComplete }) => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        // 0.8秒後にアニメーション完了（すぐに消える）
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(onComplete, 200); // フェードアウト後に削除
        }, 800);

        return () => clearTimeout(timer);
    }, [onComplete]);

    // ランダムな水平方向の動き
    const randomX = (Math.random() - 0.5) * 100;

    return (
        <div
            className={`${styles.emoji} ${!isVisible ? styles.hidden : ''}`}
            style={
                {
                    left: emoji.position.x,
                    top: emoji.position.y,
                    '--random-x': `${randomX}px`,
                } as React.CSSProperties
            }
        >
            {emoji.emoji}
        </div>
    );
};
