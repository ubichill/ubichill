/**
 * AvatarCursorSystem — ローカルカーソル・リモートカーソル・絵文字・ラジアルメニューを担当。
 *
 * avatar:cursor エンティティの transform.z が CSS zIndex として使われる。
 * cursor.worker.tsx にのみ登録される。
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
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
    scrollX,
    scrollY,
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
    setScrollX,
    setScrollY,
    setTargetX,
    setTargetY,
    targetX,
    targetY,
} from '../state';
import type { FloatingEmoji, UserStatus } from '../types';
import { EmojiFloat } from '../ui/EmojiFloat';
import { LocalCursor } from '../ui/LocalCursor';
import { RadialMenu } from '../ui/RadialMenu';
import { RemoteCursor } from '../ui/RemoteCursor';
import { cssToState } from './AvatarMainSystem';

export function sendEmoji(emoji: string): void {
    // radialMenuPos はビューポート座標。ブロードキャストにはワールド座標を使う。
    const worldPos = radialMenuPos
        ? { x: radialMenuPos.x + scrollX, y: radialMenuPos.y + scrollY }
        : { x: lerpX, y: lerpY };
    // ローカル表示はビューポート座標（EmojiFloat は position:fixed）
    const viewportPos = radialMenuPos ?? { x: lerpX - scrollX, y: lerpY - scrollY };
    const timestamp = Date.now();
    const id = `${timestamp}-local`;
    const fe = { id, emoji, position: viewportPos, timestamp };
    setFloatingEmojis([...floatingEmojis, fe]);
    Ubi.ui.render(() => <EmojiFloat fe={fe} />, `emoji-${id}`);
    Ubi.network.broadcast('emoji:broadcast', {
        emoji,
        position: worldPos,
        userId: Ubi.myUserId ?? '',
        timestamp,
    });
    setRadialMenuPos(null);
    setActiveSubmenuId(null);
    Ubi.network.sendToHost('user:update', { isMenuOpen: false });
}

export const AvatarCursorSystem: System = (_entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    const myUserId = Ubi.myUserId;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as {
                x: number;
                y: number;
                viewportX: number;
                viewportY: number;
                buttons: number;
                cursorStyle?: string;
            };
            if (!initialized) {
                setLerpX(d.x);
                setLerpY(d.y);
                setInitialized(true);
            }
            setTargetX(d.x);
            setTargetY(d.y);
            if (d.cursorStyle && d.cursorStyle !== localCursorStyle) {
                setLocalCursorStyle(d.cursorStyle);
            }
        }

        if (event.type === EcsEventType.INPUT_CONTEXT_MENU) {
            const d = event.payload as { x: number; y: number; viewportX: number; viewportY: number };
            setRadialMenuPos({ x: d.viewportX, y: d.viewportY });
            Ubi.network.sendToHost('user:update', { isMenuOpen: true });
        }

        if (event.type === EcsEventType.INPUT_SCROLL) {
            const d = event.payload as { x: number; y: number };
            setScrollX(d.x);
            setScrollY(d.y);
            // スクロール変化時に全リモートカーソルをビューポート座標で再描画
            for (const [userId, user] of remoteUsers) {
                const vx = user.position.x - d.x;
                const vy = user.position.y - d.y;
                Ubi.ui.render(
                    () => <RemoteCursor user={{ ...user, position: { x: vx, y: vy } }} />,
                    `cursor-${userId}`,
                );
            }
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
                penColor?: string | null;
            };
            if (user.id === myUserId) {
                if (user.status) setLocalStatus(user.status);
                if (user.avatar) setLocalAvatar(user.avatar);
            } else {
                const worldPos = user.position ?? { x: 0, y: 0 };
                remoteUsers.set(user.id, {
                    id: user.id,
                    name: user.name,
                    position: worldPos,
                    cursorState: user.cursorState,
                    status: user.status,
                    avatar: user.avatar,
                    isMenuOpen: user.isMenuOpen,
                    penColor: user.penColor,
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
                    // position はワールド座標で保存し、描画時にスクロール分を引く
                    remoteUsers.set(userId, { ...user, position });
                    const updatedUser = remoteUsers.get(userId);
                    if (updatedUser) {
                        const vx = position.x - scrollX;
                        const vy = position.y - scrollY;
                        Ubi.ui.render(
                            () => <RemoteCursor user={{ ...updatedUser, position: { x: vx, y: vy } }} />,
                            `cursor-${userId}`,
                        );
                    }
                }
            }
        }

        if (event.type === EcsEventType.NETWORK_BROADCAST) {
            const broadcast = event.payload as { type: string; userId: string; data: unknown };
            if (broadcast.type === 'emoji:broadcast') {
                const d = broadcast.data as {
                    emoji: string;
                    position: { x: number; y: number };
                    timestamp: number;
                };
                if (broadcast.userId !== myUserId) {
                    // d.position はワールド座標。EmojiFloat は position:fixed なのでビューポートへ変換。
                    const viewportPos = { x: d.position.x - scrollX, y: d.position.y - scrollY };
                    const fe = {
                        id: `${d.timestamp}-${broadcast.userId}`,
                        emoji: d.emoji,
                        position: viewportPos,
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

    // ローカルカーソル（毎 tick: lerp で位置が変わるため）
    Ubi.ui.render(() => <LocalCursor />, 'local-cursor');

    // ラジアルメニュー
    if (radialMenuPos !== null) {
        const menuPos = radialMenuPos;
        Ubi.ui.render(() => <RadialMenu pos={menuPos} />, 'radial');
    } else {
        Ubi.ui.unmount('radial');
    }
};
