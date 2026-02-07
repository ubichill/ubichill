import type React from 'react';

export const PenIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 48 }) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        style={{ filter: 'drop-shadow(2px 2px 3px rgba(0,0,0,0.3))' }}
    >
        <path
            d="M3 21L3.5 17L17 3.5C18.1046 2.39543 19.8954 2.39543 21 3.5C22.1046 4.60457 22.1046 6.39543 21 7.5L7.5 21L3 21Z"
            fill={color}
            stroke="#333"
            strokeWidth="1"
        />
        <path d="M3 21L5 19" stroke="#333" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M15 6L18 9" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinecap="round" />
    </svg>
);
