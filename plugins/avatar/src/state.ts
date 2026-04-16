import type { AppAvatarDef } from '@ubichill/sdk';

export interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

export const LERP_SPEED = 0.015;
export const SNAP_THRESHOLD = 0.1;

// ============================================================
// cursor.worker 専用ストア
// ============================================================
export const cursor = {
    lerpViewportX: 0,
    lerpViewportY: 0,
    targetViewportX: 0,
    targetViewportY: 0,
    initialized: false,
    cursorStyle: 'default',
    avatar: { states: {} } as AppAvatarDef,
    zIndex: 10100,
};

export function resetCursor(): void {
    cursor.lerpViewportX = 0;
    cursor.lerpViewportY = 0;
    cursor.targetViewportX = 0;
    cursor.targetViewportY = 0;
    cursor.initialized = false;
    cursor.cursorStyle = 'default';
    cursor.avatar = { states: {} };
}

// ============================================================
// settings.worker 専用ストア
// ============================================================
export const settings = {
    templates: [] as TemplateEntry[],
    currentTemplateId: null as string | null,
    templatesLoaded: false,
    thumbnailUrls: new Map<string, string>(),
    dirty: true,
    cursorStyle: 'default',
    avatar: { states: {} } as AppAvatarDef,
    zIndex: 9998,
};
