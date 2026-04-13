import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import type { TemplateEntry } from '../state';
import {
    EMOJI_DURATION_MS,
    floatingEmojis,
    initialized,
    LERP_SPEED,
    lastPositionSentAt,
    lastSentCursorState,
    lastSentX,
    lastSentY,
    lerpX,
    lerpY,
    localCursorStyle,
    POSITION_THROTTLE_MS,
    radialMenuPos,
    remoteUsers,
    SNAP_THRESHOLD,
    setActiveSubmenuId,
    setFloatingEmojis,
    setInitialized,
    setLastPositionSentAt,
    setLastSentCursorState,
    setLastSentX,
    setLastSentY,
    setLerpX,
    setLerpY,
    setLocalAvatar,
    setLocalCursorStyle,
    setLocalStatus,
    setRadialMenuPos,
    setSettingsDirty,
    setTargetX,
    setTargetY,
    setTemplates,
    setTemplatesLoaded,
    settingsDirty,
    targetX,
    targetY,
    templatesLoaded,
} from '../state';
import type { FloatingEmoji, UserStatus } from '../types';
import { EmojiFloat } from '../ui/EmojiFloat';
import { LocalCursor } from '../ui/LocalCursor';
import { RadialMenu } from '../ui/RadialMenu';
import { RemoteCursor } from '../ui/RemoteCursor';
import { SettingsPanel } from '../ui/SettingsPanel';

export async function initTemplates(): Promise<void> {
    if (templatesLoaded) return;
    setTemplatesLoaded(true);
    try {
        const result = (await Ubi.network.fetch('/plugins/avatar/templates/manifest.json')) as {
            ok: boolean;
            body: string;
        };
        if (result.ok) {
            const data = JSON.parse(result.body) as TemplateEntry[];
            setTemplates(data);
            setSettingsDirty(true);
        }
    } catch {
        // テンプレート読み込み失敗は無視
    }
}

export function cssToState(css: string): string {
    if (css === 'pointer') return 'pointer';
    if (css === 'text' || css === 'vertical-text') return 'text';
    if (css === 'wait' || css === 'progress') return 'wait';
    if (css === 'help') return 'help';
    if (css === 'not-allowed' || css === 'no-drop') return 'not-allowed';
    if (css === 'move') return 'move';
    if (css === 'grabbing') return 'grabbing';
    return 'default';
}

export function changeStatus(newStatus: UserStatus): void {
    setLocalStatus(newStatus);
    setRadialMenuPos(null);
    setActiveSubmenuId(null);
    Ubi.network.sendToHost('user:update', { status: newStatus, isMenuOpen: false });
}

export function sendEmoji(emoji: string): void {
    const pos = radialMenuPos ?? { x: lerpX, y: lerpY };
    const timestamp = Date.now();
    const id = `${timestamp}-local`;
    const fe = { id, emoji, position: pos, timestamp };
    setFloatingEmojis([...floatingEmojis, fe]);
    Ubi.ui.render(() => <EmojiFloat fe={fe} />, `emoji-${id}`);
    Ubi.network.broadcast('emoji:broadcast', {
        emoji,
        position: pos,
        userId: Ubi.myUserId ?? '',
        timestamp,
    });
    setRadialMenuPos(null);
    setActiveSubmenuId(null);
    Ubi.network.sendToHost('user:update', { isMenuOpen: false });
}

export const AvatarMainSystem: System = (_entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    void initTemplates();
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as { x: number; y: number; buttons: number; cursorStyle?: string };
            if (!initialized) {
                setLerpX(d.x);
                setLerpY(d.y);
                setInitialized(true);
            }
            setTargetX(d.x);
            setTargetY(d.y);
            if (d.cursorStyle && d.cursorStyle !== localCursorStyle) {
                setLocalCursorStyle(d.cursorStyle);
                setSettingsDirty(true);
            }
        }

        if (event.type === EcsEventType.INPUT_CONTEXT_MENU) {
            const d = event.payload as { x: number; y: number; clientX: number; clientY: number };
            setRadialMenuPos({ x: d.clientX, y: d.clientY });
            Ubi.network.sendToHost('user:update', { isMenuOpen: true });
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as {
                id: string;
                name: string;
                position?: { x: number; y: number };
                cursorState?: string;
                status: UserStatus;
                avatar?: AppAvatarDef;
                isMenuOpen?: boolean;
            };
            if (user.id === myUserId) {
                if (user.status) setLocalStatus(user.status);
                if (user.avatar) {
                    setLocalAvatar(user.avatar);
                    setSettingsDirty(true);
                }
            } else {
                remoteUsers.set(user.id, {
                    id: user.id,
                    name: user.name,
                    position: user.position ?? { x: 0, y: 0 },
                    cursorState: user.cursorState,
                    status: user.status,
                    avatar: user.avatar,
                    isMenuOpen: user.isMenuOpen,
                });
            }
        }

        if (event.type === EcsEventType.PLAYER_LEFT) {
            const userId = event.payload as string;
            remoteUsers.delete(userId);
            Ubi.ui.unmount(`cursor-${userId}`);
        }

        if (event.type === EcsEventType.PLAYER_CURSOR_MOVED) {
            const { userId, position } = event.payload as {
                userId: string;
                position: { x: number; y: number };
            };
            if (userId !== myUserId) {
                const user = remoteUsers.get(userId);
                if (user) {
                    remoteUsers.set(userId, { ...user, position });
                    // 移動したカーソルのみ即時再描画
                    const updatedUser = remoteUsers.get(userId);
                    if (updatedUser) {
                        Ubi.ui.render(() => <RemoteCursor user={updatedUser} />, `cursor-${userId}`);
                    }
                }
            }
        }

        if (event.type === EcsEventType.NETWORK_BROADCAST) {
            const broadcast = event.payload as {
                type: string;
                userId: string;
                data: unknown;
            };
            if (broadcast.type === 'emoji:broadcast') {
                const d = broadcast.data as {
                    emoji: string;
                    position: { x: number; y: number };
                    timestamp: number;
                };
                if (broadcast.userId !== myUserId) {
                    const fe = {
                        id: `${d.timestamp}-${broadcast.userId}`,
                        emoji: d.emoji,
                        position: d.position,
                        timestamp: d.timestamp,
                    };
                    setFloatingEmojis([...floatingEmojis, fe]);
                    Ubi.ui.render(() => <EmojiFloat fe={fe} />, `emoji-${fe.id}`);
                }
            }
        }
    }

    // lerp
    if (initialized) {
        const dx = targetX - lerpX;
        const dy = targetY - lerpY;
        if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
            setLerpX(targetX);
            setLerpY(targetY);
        } else {
            const f = Math.min(1, deltaTime * LERP_SPEED);
            setLerpX(lerpX + dx * f);
            setLerpY(lerpY + dy * f);
        }

        const now = Date.now();
        const cursorState = cssToState(localCursorStyle);
        if (
            now - lastPositionSentAt > POSITION_THROTTLE_MS &&
            (lerpX !== lastSentX || lerpY !== lastSentY || cursorState !== lastSentCursorState)
        ) {
            setLastPositionSentAt(now);
            setLastSentX(lerpX);
            setLastSentY(lerpY);
            setLastSentCursorState(cursorState);
            Ubi.network.sendToHost('position:update', { x: lerpX, y: lerpY, cursorState });
        }
    }

    // 絵文字クリーンアップ
    const now = Date.now();
    const newEmojis = floatingEmojis.filter((fe: FloatingEmoji) => {
        const alive = now - fe.timestamp <= EMOJI_DURATION_MS;
        if (!alive) Ubi.ui.unmount(`emoji-${fe.id}`);
        return alive;
    });
    if (newEmojis.length !== floatingEmojis.length) {
        setFloatingEmojis(newEmojis);
    }

    // ── VNode 描画 ────────────────────────────────────────────────

    // ローカルカーソル（毎 tick: lerp で位置が変わるため）
    Ubi.ui.render(() => <LocalCursor />, 'local-cursor');

    // 設定パネル: 状態変化時のみ再描画
    if (settingsDirty) {
        setSettingsDirty(false);
        Ubi.ui.render(() => <SettingsPanel />, 'settings');
    }

    // ラジアルメニュー
    if (radialMenuPos !== null) {
        const menuPos = radialMenuPos;
        Ubi.ui.render(() => <RadialMenu pos={menuPos} />, 'radial');
    } else {
        Ubi.ui.unmount('radial');
    }
};
