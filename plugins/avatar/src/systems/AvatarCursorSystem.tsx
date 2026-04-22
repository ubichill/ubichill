/**
 * AvatarCursorSystem — ローカル・リモート両カーソルの表示を担当。
 * cursor.worker.tsx にのみ登録される。
 *
 * 状態は cursor に一元管理する。
 * - ローカル専用フィールド (lerpX, lerpY, ...) は cursor.local から直接読み書き
 * - shared フィールド (cursorState, avatar) も cursor.local への代入で全ユーザーへ同期
 * - 描画は cursor.renderForEachUser() で全ユーザー統一
 */

import type { AppAvatarDef, Entity, System, WorkerEvent } from '@ubichill/sdk';
import { EcsEventType } from '@ubichill/sdk';
import { CursorImage } from '../ui/AvatarCursor';
import { cssToState } from './utils';

// ── 型 ──────────────────────────────────────────────────────────────
interface AnimFrame {
    url: string;
    duration: number; // ms
}

// ── 定数 ─────────────────────────────────────────────────────────────
const LERP_SPEED = 0.015;
const SNAP_THRESHOLD = 0.1;

// ── エンティティ状態 ─────────────────────────────────────────────────
/**
 * カーソルの全状態。スコープマーカーで各フィールドの同期方式を宣言する。
 * ローカル専用フィールドは cursor.local から直接読み書きし、
 * shared フィールドも同じく cursor.local への代入で全ユーザーへ同期される。
 */
const cursor = Ubi.state.define({
    // ローカル専用（lerp・アニメーション・表示制御）
    lerpX: 0,
    lerpY: 0,
    targetX: 0,
    targetY: 0,
    initialized: false,
    localCursorStyle: 'default',
    zIndex: 10100,
    // グローバル同期（presence 経由で全ユーザーに配布）
    cursorState: Ubi.state.shared('default' as string),
    avatar: Ubi.state.shared(null as AppAvatarDef | null),
});

// ── フレームキャッシュ（全ユーザー共用、sourceUrl キー） ──────────────
const framesCache = new Map<string, AnimFrame[]>();
const requestedUrls = new Set<string>();
/** レスポンスとの照合用キュー */
const pendingRequests: Array<Array<{ state: string; sourceUrl: string }>> = [];
/** ユーザーごとのアニメーション状態（ローカル・同期不要） */
const userAnim = new Map<string, { frame: number; elapsed: number }>();

// ── ヘルパー ──────────────────────────────────────────────────────────
export function setZIndex(z: number): void {
    cursor.local.zIndex = z;
}

function ensureFrames(avatar: AppAvatarDef): void {
    const toRequest: Array<{ state: string; sourceUrl: string }> = [];
    for (const [state, def] of Object.entries(avatar.states)) {
        if (def?.sourceUrl && !requestedUrls.has(def.sourceUrl)) {
            requestedUrls.add(def.sourceUrl);
            toRequest.push({ state, sourceUrl: def.sourceUrl });
        }
    }
    if (toRequest.length > 0) {
        pendingRequests.push(toRequest);
        Ubi.network.sendToHost('avatar:requestFrames', { sourceUrls: toRequest });
    }
}

function getFrames(avatar: AppAvatarDef, state: string): AnimFrame[] | undefined {
    const stateDef = avatar.states[state as keyof typeof avatar.states] ?? avatar.states.default;
    return stateDef?.sourceUrl ? framesCache.get(stateDef.sourceUrl) : undefined;
}

// ─────────────────────────────────────────────────────────────────────
export const AvatarCursorSystem: System = (_entities: Entity[], deltaTime: number, events: WorkerEvent[]) => {
    const { local } = cursor;

    for (const event of events) {
        if (event.type === EcsEventType.INPUT_CURSOR_STYLE) {
            const d = event.payload as { style: string };
            if (d.style !== local.localCursorStyle) {
                local.localCursorStyle = d.style;
                local.cursorState = cssToState(d.style);
            }
        }

        if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
            const d = event.payload as { viewportX: number; viewportY: number };
            if (!local.initialized) {
                local.lerpX = d.viewportX;
                local.lerpY = d.viewportY;
                local.initialized = true;
            }
            local.targetX = d.viewportX;
            local.targetY = d.viewportY;
        }

        if (event.type === EcsEventType.PLAYER_JOINED) {
            const user = event.payload as { id: string; avatar?: AppAvatarDef };
            if (user.id === Ubi.myUserId && user.avatar) {
                local.avatar = user.avatar;
                local.cursorState = 'default';
                ensureFrames(user.avatar);
            }
        }

        if (event.type === EcsEventType.HOST_MESSAGE) {
            const m = event.payload as { type: string; payload: unknown };
            if (m.type === 'avatar:localFrames') {
                const { framesMap } = m.payload as { framesMap: Record<string, AnimFrame[]> };
                const batch = pendingRequests.shift();
                if (batch) {
                    for (const { state, sourceUrl } of batch) {
                        const frames = framesMap[state];
                        if (frames) framesCache.set(sourceUrl, frames);
                    }
                }
            }
        }
    }

    // viewport lerp（自分のカーソルのみ）
    if (local.initialized) {
        const dvx = local.targetX - local.lerpX;
        const dvy = local.targetY - local.lerpY;
        if (Math.abs(dvx) < SNAP_THRESHOLD && Math.abs(dvy) < SNAP_THRESHOLD) {
            local.lerpX = local.targetX;
            local.lerpY = local.targetY;
        } else {
            const f = Math.min(1, deltaTime * LERP_SPEED);
            local.lerpX += dvx * f;
            local.lerpY += dvy * f;
        }
    }

    // 全ユーザーのアニメーションをローカルで独立して進める
    for (const [userId] of Ubi.presence.users()) {
        const { avatar, cursorState } = cursor.for(userId);
        if (!avatar) continue;

        if (userId !== Ubi.myUserId) ensureFrames(avatar);

        const state = cssToState(cursorState);
        const frames = getFrames(avatar, state);
        const anim = userAnim.get(userId) ?? { frame: 0, elapsed: 0 };
        if (!userAnim.has(userId)) userAnim.set(userId, anim);

        if (frames && frames.length > 1) {
            anim.elapsed += deltaTime;
            const dur = frames[anim.frame]?.duration ?? 100;
            if (anim.elapsed >= dur) {
                anim.elapsed -= dur;
                anim.frame = (anim.frame + 1) % frames.length;
            }
        } else {
            anim.frame = 0;
            anim.elapsed = 0;
        }
    }
    for (const userId of userAnim.keys()) {
        if (!Ubi.presence.users().has(userId)) userAnim.delete(userId);
    }

    // 全ユーザー描画
    cursor.renderForEachUser('cursor', (state) => {
        const isSelf = state.id === Ubi.myUserId;
        const viewportX = isSelf ? local.lerpX : state.viewportX;
        const viewportY = isSelf ? local.lerpY : state.viewportY;

        const { avatar, cursorState } = state;
        if (!avatar) return null;

        const avatarState = cssToState(cursorState);
        const stateDef = avatar.states[avatarState as keyof typeof avatar.states] ?? avatar.states.default;
        if (!stateDef?.url) return null;

        const frames = getFrames(avatar, avatarState);
        const anim = userAnim.get(state.id);
        const url = frames && frames.length > 0 && anim ? (frames[anim.frame]?.url ?? stateDef.url) : stateDef.url;

        return (
            <CursorImage
                viewportX={viewportX}
                viewportY={viewportY}
                url={url}
                hotspot={stateDef.hotspot}
                zIndex={isSelf ? local.zIndex : local.zIndex - 1}
            />
        );
    });
};
