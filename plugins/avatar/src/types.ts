import type { AppAvatarDef } from '@ubichill/sdk';

export type UserStatus = 'online' | 'busy' | 'dnd';

export type RemoteUser = {
    id: string;
    name: string;
    position: { x: number; y: number };
    cursorState?: string;
    status: UserStatus;
    avatar?: AppAvatarDef;
    isMenuOpen?: boolean;
    penColor?: string | null;
};

export type FloatingEmoji = {
    id: string;
    emoji: string;
    position: { x: number; y: number };
    timestamp: number;
};

export type RadialMenuItem = {
    id: string;
    label: string;
    icon: string;
    action?: () => void;
    submenu?: RadialMenuItem[];
};
