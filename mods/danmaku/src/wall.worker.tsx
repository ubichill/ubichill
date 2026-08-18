import type { ComponentConfig } from '@ubichill/sdk';

export const config: ComponentConfig = {
    capabilities: ['ui:render'],
    description: 'core:collider と同じEntityに置く、弾幕ワールドの壁の見た目。',
};

export default function WallView() {
    return (
        <div
            style={{
                width: '100%',
                height: '100%',
                boxSizing: 'border-box',
                border: '1px solid rgba(125, 211, 252, 0.9)',
                background: 'linear-gradient(135deg, rgba(14,116,144,.9), rgba(30,58,138,.95))',
                boxShadow: '0 0 10px rgba(34,211,238,.65)',
            }}
        />
    );
}
