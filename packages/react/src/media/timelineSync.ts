import type { MediaTimeline } from '@ubichill/shared';

export interface TimelinePlaybackCorrection {
    seekTime: number | null;
    playbackRate: number;
}

/** Server の正規時計へ実動画を追従させる。小さな差は速度、大きな差と停止中の差は seek で直す。 */
export function planTimelinePlaybackCorrection(
    phase: MediaTimeline['phase'],
    expectedTime: number,
    currentTime: number,
    canonicalRate: number,
): TimelinePlaybackCorrection {
    const drift = expectedTime - currentTime;
    if (phase !== 'playing') {
        return { seekTime: Math.abs(drift) >= 0.04 ? expectedTime : null, playbackRate: canonicalRate };
    }
    if (Math.abs(drift) >= 0.75) return { seekTime: expectedTime, playbackRate: canonicalRate };
    if (Math.abs(drift) < 0.12) return { seekTime: null, playbackRate: canonicalRate };
    const adjustment = Math.max(-0.05, Math.min(0.05, drift * 0.1));
    return { seekTime: null, playbackRate: canonicalRate * (1 + adjustment) };
}
