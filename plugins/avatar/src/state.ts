import type { AppAvatarDef } from '@ubichill/sdk';
import type { RemoteUser, UserStatus } from './types';

export interface TemplateEntry {
    id: string;
    name: string;
    directory: string;
    mappings: Partial<Record<string, string>>;
}

export const remoteUsers = new Map<string, RemoteUser>();
export let lerpX = 0;
export let lerpY = 0;
export let targetX = 0;
export let targetY = 0;
export let initialized = false;
export let localCursorStyle = 'default';
export let localStatus: UserStatus = 'online';
export let localAvatar: AppAvatarDef = { states: {} };
export let lastSentX = -1;
export let lastSentY = -1;
export let lastSentCursorState = '';
export let lastPositionSentAt = 0;
export let scrollX = 0;
export let scrollY = 0;

export let templates: TemplateEntry[] = [];
export let currentTemplateId: string | null = null;
export let templatesLoaded = false;
/** テンプレート ID → サムネイル data URL（ホストから事前変換済みで受け取る） */
export const thumbnailUrls: Map<string, string> = new Map();
/** true の間だけ次 tick で SettingsPanel を再描画し、描画後に false に戻す */
export let settingsDirty = true;
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

/** カーソルオーバーレイの CSS zIndex。avatar:cursor エンティティの transform.z から設定 */
export let cursorZIndex = 10100;
export function setCursorZIndex(v: number) {
    cursorZIndex = v;
}

/** 設定パネルの CSS zIndex。avatar:settings エンティティの transform.z から設定 */
export let settingsPanelZIndex = 9998;
export function setSettingsPanelZIndex(v: number) {
    settingsPanelZIndex = v;
}

export const POSITION_THROTTLE_MS = 50;
export const LERP_SPEED = 0.015;
export const SNAP_THRESHOLD = 0.1;

export function resetState(): void {
    remoteUsers.clear();
    lerpX = 0;
    lerpY = 0;
    targetX = 0;
    targetY = 0;
    initialized = false;
    localCursorStyle = 'default';
    localStatus = 'online';
    localAvatar = { states: {} };
    lastSentX = -1;
    lastSentY = -1;
    lastSentCursorState = '';
    lastPositionSentAt = 0;
    scrollX = 0;
    scrollY = 0;
}

export function setLerpX(v: number) {
    lerpX = v;
}
export function setLerpY(v: number) {
    lerpY = v;
}
export function setTargetX(v: number) {
    targetX = v;
}
export function setTargetY(v: number) {
    targetY = v;
}
export function setInitialized(v: boolean) {
    initialized = v;
}
export function setLocalCursorStyle(v: string) {
    localCursorStyle = v;
}
export function setLocalStatus(v: UserStatus) {
    localStatus = v;
}
export function setLocalAvatar(v: AppAvatarDef) {
    localAvatar = v;
}
export function setLastSentX(v: number) {
    lastSentX = v;
}
export function setLastSentY(v: number) {
    lastSentY = v;
}
export function setLastSentCursorState(v: string) {
    lastSentCursorState = v;
}
export function setLastPositionSentAt(v: number) {
    lastPositionSentAt = v;
}
export function setScrollX(v: number) {
    scrollX = v;
}
export function setScrollY(v: number) {
    scrollY = v;
}
