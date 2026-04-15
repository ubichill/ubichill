import type { AppAvatarDef } from '@ubichill/sdk';

export type UserStatus = 'online' | 'busy' | 'dnd';

export type RemoteUser = {
    id: string;
    name: string;
    position: { x: number; y: number };
    cursorState?: string;
    status: UserStatus;
    avatar?: AppAvatarDef;
    penColor?: string | null;
};
