import type { AppAvatarDef } from '@ubichill/sdk';

export interface AnimFrame {
    url: string;
    duration: number; // ms
}

export interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

export const LERP_SPEED = 0.015;
export const SNAP_THRESHOLD = 0.1;
export const DEFAULT_TEMPLATE_ID = 'character_oji_03_blue_brown';

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
    /** 現在表示中のアニメーションフレームインデックス */
    animFrame: 0,
    /** 現在フレームの経過時間 (ms) */
    animElapsed: 0,
    /** カーソル状態ごとのローカルフレーム（host から受け取る、サーバー送信しない） */
    stateFrames: {} as Record<string, AnimFrame[]>,
};

export function resetCursor(): void {
    cursor.lerpViewportX = 0;
    cursor.lerpViewportY = 0;
    cursor.targetViewportX = 0;
    cursor.targetViewportY = 0;
    cursor.initialized = false;
    cursor.cursorStyle = 'default';
    cursor.avatar = { states: {} };
    cursor.animFrame = 0;
    cursor.animElapsed = 0;
    cursor.stateFrames = {};
}

// ============================================================
// settings.worker 専用ストア
// ============================================================
export const settings = {
    templates: [] as TemplateEntry[],
    currentTemplateId: null as string | null,
    templatesLoaded: false,
    hasLocalUserSnapshot: false,
    defaultTemplateEvaluated: false,
    thumbnailUrls: new Map<string, string>(),
    dirty: true,
    cursorStyle: 'default',
    avatar: { states: {} } as AppAvatarDef,
    zIndex: 9998,
};
