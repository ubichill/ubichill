import type React from 'react';

type IconProps = { size: number | string; strokeWidth?: number };

const Icon: React.FC<IconProps & { children: React.ReactNode }> = ({ size, strokeWidth = 2, children }) => (
    <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        {children}
    </svg>
);

export const WarpIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </Icon>
);

export const SwitchIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <rect x="2" y="6" width="20" height="12" rx="6" />
        <circle cx="16" cy="12" r="3" />
    </Icon>
);

export const PortalIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
        <path d="m10 17 5-5-5-5" />
        <path d="M15 12H3" />
    </Icon>
);

export const LockIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Icon>
);

export const CloseIcon: React.FC<IconProps> = (props) => (
    <Icon {...props}>
        <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
);
