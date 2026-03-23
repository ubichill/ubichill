// 型は必要に応じて @ubichill/sdk から import してください

// 音楽プレイヤーの状態タイプ
export interface Track {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    author?: string;
    mode: 'live' | 'video'; // ライブストリームか通常動画か
}

export interface MusicPlayerState {
    playlist: Track[];
    currentIndex: number;
    isPlaying: boolean;
    currentTime: number; // 秒
    loop: 'none' | 'playlist' | 'track';
    shuffle: boolean;
}

export const DEFAULT_MUSIC_PLAYER_STATE: MusicPlayerState = {
    playlist: [],
    currentIndex: 0,
    isPlaying: false,
    currentTime: 0,
    loop: 'playlist',
    shuffle: false,
};

/** @deprecated 代わりに @ubichill/sdk/react の WidgetDefinition を使用してください */
export type { WidgetDefinition } from '@ubichill/sdk/react';
