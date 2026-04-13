import { EMOJI_DURATION_MS } from '../state';
import type { FloatingEmoji } from '../types';

export interface EmojiFloatProps {
    fe: FloatingEmoji;
}

export const EmojiFloat = ({ fe }: EmojiFloatProps) => {
    const elapsed = Date.now() - fe.timestamp;
    const progress = Math.min(1, elapsed / EMOJI_DURATION_MS);
    const opacity = 1 - progress;
    const offsetY = -progress * 60;
    return (
        <div
            style={{
                position: 'fixed',
                left: fe.position.x - 16,
                top: fe.position.y + offsetY,
                fontSize: '32px',
                pointerEvents: 'none',
                zIndex: 10002,
                opacity,
            }}
        >
            {fe.emoji}
        </div>
    );
};
