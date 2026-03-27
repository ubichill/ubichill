import type { WidgetDefinition } from '@ubichill/sdk/react';

export const avatarWidgetDefinition: WidgetDefinition = {
    id: 'avatar',
    name: 'Avatar',
    elementTag: 'avatar-widget',
    singletonTag: 'avatar-singleton',
    register: () => {
        if (!customElements.get('avatar-widget')) {
            import('./AvatarWidgetElement').then(({ AvatarWidgetElement }) => {
                customElements.define('avatar-widget', AvatarWidgetElement);
            });
        }
        if (!customElements.get('avatar-singleton')) {
            import('./AvatarSingletonElement').then(({ AvatarSingletonElement }) => {
                customElements.define('avatar-singleton', AvatarSingletonElement);
            });
        }
    },
};
