import type { Track } from './types';

// Lofi Hip Hop Playlist - Default Tracks
export const DEFAULT_LOFI_PLAYLIST: Track[] = [
    {
        id: 'jfKfPfyJRdk',
        title: 'lofi hip hop radio 📚 - beats to relax/study to',
        thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/default.jpg',
        duration: 0, // Live stream
        author: 'Lofi Girl',
        mode: 'live',
    },
    {
        id: '5qap5aO4i9A',
        title: 'lofi hip hop radio 🌴 - beats to relax/chill to',
        thumbnail: 'https://i.ytimg.com/vi/5qap5aO4i9A/default.jpg',
        duration: 3600,
        author: 'Lofi Girl',
        mode: 'video',
    },
];

// Study Focus Playlist
export const STUDY_PLAYLIST: Track[] = [
    {
        id: 'jfKfPfyJRdk',
        title: 'lofi hip hop radio 📚 - beats to relax/study to',
        thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/default.jpg',
        duration: 0,
        author: 'Lofi Girl',
        mode: 'live',
    },
];

// Chill Vibes Playlist
export const CHILL_PLAYLIST: Track[] = [
    {
        id: '5qap5aO4i9A',
        title: 'lofi hip hop radio 🌴 - beats to relax/chill to',
        thumbnail: 'https://i.ytimg.com/vi/5qap5aO4i9A/default.jpg',
        duration: 3600,
        author: 'Lofi Girl',
        mode: 'video',
    },
];

// Playlist Manager - for easy playlist management
export const PLAYLISTS = {
    lofi: DEFAULT_LOFI_PLAYLIST,
    study: STUDY_PLAYLIST,
    chill: CHILL_PLAYLIST,
} as const;

export type PlaylistName = keyof typeof PLAYLISTS;

export const getPlaylist = (name: PlaylistName): Track[] => {
    return PLAYLISTS[name] || [];
};

export const getPlaylistNames = (): PlaylistName[] => {
    return Object.keys(PLAYLISTS) as PlaylistName[];
};

// LocalStorage key for custom playlists
const CUSTOM_PLAYLISTS_KEY = 'ubichill-video-player-custom-playlists';

// Custom playlist management
export const saveCustomPlaylist = (name: string, tracks: Track[]): void => {
    try {
        const customPlaylists = getCustomPlaylists();
        customPlaylists[name] = tracks;
        localStorage.setItem(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists));
    } catch (error) {
        console.error('Failed to save custom playlist:', error);
    }
};

export const getCustomPlaylists = (): Record<string, Track[]> => {
    try {
        const stored = localStorage.getItem(CUSTOM_PLAYLISTS_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (error) {
        console.error('Failed to load custom playlists:', error);
        return {};
    }
};

export const getCustomPlaylist = (name: string): Track[] | null => {
    const customPlaylists = getCustomPlaylists();
    return customPlaylists[name] || null;
};

export const deleteCustomPlaylist = (name: string): void => {
    try {
        const customPlaylists = getCustomPlaylists();
        delete customPlaylists[name];
        localStorage.setItem(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists));
    } catch (error) {
        console.error('Failed to delete custom playlist:', error);
    }
};
