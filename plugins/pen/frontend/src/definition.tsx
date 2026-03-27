import type { WidgetDefinition } from '@ubichill/sdk/react';

export const penWidgetDefinition: WidgetDefinition = {
    id: 'pen:pen',
    name: 'Pen',
    elementTag: 'pen-widget',
    singletonTags: ['pen-tray', 'pen-canvas'],
    register: () => {
        if (!customElements.get('pen-widget')) {
            import('./PenWidgetElement').then(({ PenWidgetElement }) => {
                customElements.define('pen-widget', PenWidgetElement);
            });
        }
        if (!customElements.get('pen-tray')) {
            import('./PenTrayElement').then(({ PenTrayElement }) => {
                customElements.define('pen-tray', PenTrayElement);
            });
        }
        if (!customElements.get('pen-canvas')) {
            import('./PenCanvasElement').then(({ PenCanvasElement }) => {
                customElements.define('pen-canvas', PenCanvasElement);
            });
        }
    },
};
