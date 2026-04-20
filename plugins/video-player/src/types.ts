/**
 * video-player 共通型。
 * 共有状態 (ScreenData) と UI ローカル型 (Track, SearchResult) を定義する。
 */

export interface Track {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    mode: 'live' | 'video';
}

export interface SearchResult {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
}

export type LoopMode = 'none' | 'playlist' | 'track';

/**
 * エンティティデータ (全ユーザー共有)。
 *
 * 音量は per-user なので ScreenData には含めない。
 * 代わりに entity.data のトップレベルに `vol_<userId>` キーで格納する
 * (shallow merge で他ユーザーの音量を壊さないため)。
 */
export interface ScreenData {
    playlist: Track[];
    currentIndex: number;
    isPlaying: boolean;
    isVisible: boolean;
    loop: LoopMode;
    shuffle: boolean;
    currentTime: number;
    duration: number;
    apiBase: string;
    seekNonce: number;
}

export const VOLUME_KEY_PREFIX = 'vol_';

export const volumeKey = (userId: string): string => `${VOLUME_KEY_PREFIX}${userId}`;

export const readUserVolume = (data: Record<string, unknown>, userId: string, fallback = 0.7): number => {
    const v = data[volumeKey(userId)];
    return typeof v === 'number' ? v : fallback;
};
