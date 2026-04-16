import type { AppAvatarDef } from '@ubichill/sdk';

export interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

// カーソル状態
export let lerpViewportX = 0;
export let lerpViewportY = 0;
export let targetViewportX = 0;
export let targetViewportY = 0;
export let initialized = false;
export let localCursorStyle = 'default';
export let localAvatar: AppAvatarDef = { states: {} };

// 設定状態
export let templates: TemplateEntry[] = [];
export let currentTemplateId: string | null = null;
export let templatesLoaded = false;
/** テンプレート ID → サムネイル data URL */
export const thumbnailUrls = new Map<string, string>();
export let settingsDirty = true;

/** avatar:cursor エンティティの transform.z */
export let cursorZIndex = 10100;
/** avatar:settings エンティティの transform.z */
export let settingsPanelZIndex = 9998;

export const LERP_SPEED = 0.015;
export const SNAP_THRESHOLD = 0.1;

export function resetState(): void {
    lerpViewportX = 0;
    lerpViewportY = 0;
    targetViewportX = 0;
    targetViewportY = 0;
    initialized = false;
    localCursorStyle = 'default';
    localAvatar = { states: {} };
}

export function setLerpViewportX(v: number) {
    lerpViewportX = v;
}
export function setLerpViewportY(v: number) {
    lerpViewportY = v;
}
export function setTargetViewportX(v: number) {
    targetViewportX = v;
}
export function setTargetViewportY(v: number) {
    targetViewportY = v;
}
export function setInitialized(v: boolean) {
    initialized = v;
}
export function setLocalCursorStyle(v: string) {
    localCursorStyle = v;
}
export function setLocalAvatar(v: AppAvatarDef) {
    localAvatar = v;
}
export function setTemplates(v: TemplateEntry[]) {
    templates = v;
}
export function setCurrentTemplateId(v: string | null) {
    currentTemplateId = v;
}
export function setTemplatesLoaded(v: boolean) {
    templatesLoaded = v;
}
export function setSettingsDirty(v: boolean) {
    settingsDirty = v;
}
export function setCursorZIndex(v: number) {
    cursorZIndex = v;
}
export function setSettingsPanelZIndex(v: number) {
    settingsPanelZIndex = v;
}
