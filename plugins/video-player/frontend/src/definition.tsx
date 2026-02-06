import { VideoIcon } from './icons';
import type { WidgetDefinition } from './types';
import { DEFAULT_MUSIC_PLAYER_STATE, type MusicPlayerState } from './types';
import { VideoPlayer } from './VideoPlayer';

export const videoPlayerDefinition: WidgetDefinition<MusicPlayerState> = {
    id: 'video-player',
    name: 'Video Player',
    icon: <VideoIcon size={18} />,
    defaultSize: { w: 320, h: 480 },
    defaultData: DEFAULT_MUSIC_PLAYER_STATE,
    Component: VideoPlayer,
};
