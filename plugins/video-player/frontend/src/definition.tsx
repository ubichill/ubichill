import type { WidgetDefinition } from '@ubichill/sdk/react';

export const videoPlayerDefinition: WidgetDefinition = {
    id: 'video-player',
    name: 'Video Player',
    elementTag: 'video-player-widget',
    register: () => {
        if (!customElements.get('video-player-widget')) {
            import('./VideoPlayerElement').then(({ VideoPlayerElement }) => {
                customElements.define('video-player-widget', VideoPlayerElement);
            });
        }
    },
};
