import type { WorldEntity } from '@ubichill/shared';
// React is peer dependency
import type React from 'react';
import type { ReactNode } from 'react';

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
    volume: number; // 0-1
    currentTime: number; // 秒
    loop: 'none' | 'playlist' | 'track';
    shuffle: boolean;
}

export const DEFAULT_MUSIC_PLAYER_STATE: MusicPlayerState = {
    playlist: [],
    currentIndex: 0,
    isPlaying: false,
    volume: 0.7,
    currentTime: 0,
    loop: 'playlist',
    shuffle: false,
};

export interface WidgetDefinition<T = unknown> {
    id: string;
    name: string;
    icon: ReactNode;
    defaultSize: { w: number; h: number };
    defaultData: T;
    Component: React.FC<{
        entity: WorldEntity<T>;
        isLocked: boolean;
        update: (patch: Partial<WorldEntity<T>>) => void;
        ephemeral?: unknown;
        broadcast?: (data: unknown) => void;
    }>;
    SingletonComponent?: React.FC;
}
