/**
 * avatar:cursor Worker — ローカル + リモートカーソル表示。
 *
 * singleton: true (ユーザー 1 人に 1 インスタンス)。
 * 状態管理:
 *   - cursorState / avatar は Ubi.state.sync (presence 経由で全ユーザーへ揮発配布)
 *   - lerpX/lerpY/animFrame 等はローカル (同期不要)
 * 描画は cursor.renderForEachUser() で全ユーザー分を一括レンダー。
 */

import type { AppAvatarDef, Entity, System } from '@ubichill/sdk';
import { cssToState } from './cssToState';
import { AvatarEvents } from './events';
import { CursorImage } from './ui/AvatarCursor';

interface AnimFrame {
    url: string;
    duration: number; // ms
}

const LERP_SPEED = 0.015;
const SNAP_THRESHOLD = 0.1;
const DEFAULT_Z = 10100;

const cursor = Ubi.state.define({
    // ローカル専用 (lerp / アニメーション / 表示制御)
    lerpX: 0,
    lerpY: 0,
    targetX: 0,
    targetY: 0,
    initialized: false,
    localCursorStyle: 'default',
    zIndex: DEFAULT_Z,
    // 全ユーザー共有 (presence 経由)
    cursorState: Ubi.state.sync('default' as string, { ephemeral: true }),
    avatar: Ubi.state.sync(null as AppAvatarDef | null, { ephemeral: true }),
});

// ── アニメーションフレームキャッシュ (sourceUrl → frames) ──
const framesCache = new Map<string, AnimFrame[]>();
const requestedUrls = new Set<string>();
const pendingRequests: Array<Array<{ state: string; sourceUrl: string }>> = [];
const userAnim = new Map<string, { frame: number; elapsed: number }>();

function ensureFrames(avatar: AppAvatarDef): void {
    const toRequest: Array<{ state: string; sourceUrl: string }> = [];
    for (const [state, def] of Object.entries(avatar.states)) {
        if (def?.sourceUrl && !requestedUrls.has(def.sourceUrl)) {
            requestedUrls.add(def.sourceUrl);
            toRequest.push({ state, sourceUrl: def.sourceUrl });
        }
    }
    if (toRequest.length === 0) return;
    pendingRequests.push(toRequest);
    AvatarEvents.sendToHost('avatar:requestFrames', { sourceUrls: toRequest });
}

function getFrames(avatar: AppAvatarDef, state: string): AnimFrame[] | undefined {
    const stateDef = avatar.states[state as keyof typeof avatar.states] ?? avatar.states.default;
    return stateDef?.sourceUrl ? framesCache.get(stateDef.sourceUrl) : undefined;
}

// ── 自エンティティの zIndex を読み取る (transform.z) ──
void (async () => {
    const [self] = await Ubi.entity.query('avatar:cursor');
    if (self) cursor.local.zIndex = self.transform.z;
})();

// ── 位置同期は SDK に委譲 ──
Ubi.player.syncCursor({ throttleMs: 50 });

// ── イベント受信 ────────────────────────────────────
AvatarEvents.on('input:cursor_style', ({ style }) => {
    if (style === cursor.local.localCursorStyle) return;
    cursor.local.localCursorStyle = style;
    cursor.local.cursorState = cssToState(style);
});
AvatarEvents.on('input:mouse_move', ({ viewportX, viewportY }) => {
    const { local } = cursor;
    if (!local.initialized) {
        local.lerpX = viewportX;
        local.lerpY = viewportY;
        local.initialized = true;
    }
    local.targetX = viewportX;
    local.targetY = viewportY;
});
AvatarEvents.on('player:joined', (user) => {
    if (user.id !== Ubi.myUserId || !user.avatar) return;
    cursor.local.avatar = user.avatar;
    cursor.local.cursorState = 'default';
    ensureFrames(user.avatar);
});
AvatarEvents.on('avatar:localFrames', ({ framesMap }) => {
    const batch = pendingRequests.shift();
    if (!batch) return;
    for (const { state, sourceUrl } of batch) {
        const frames = framesMap[state];
        if (frames) framesCache.set(sourceUrl, frames);
    }
});

// ── ECS System (毎フレーム: lerp / アニメーション進行 / 描画) ──
const CursorSystem: System = (_entities: Entity[], deltaTime: number) => {
    const { local } = cursor;

    // ── 自分のカーソルのみ lerp ──
    if (local.initialized) {
        const dx = local.targetX - local.lerpX;
        const dy = local.targetY - local.lerpY;
        if (Math.abs(dx) < SNAP_THRESHOLD && Math.abs(dy) < SNAP_THRESHOLD) {
            local.lerpX = local.targetX;
            local.lerpY = local.targetY;
        } else {
            const f = Math.min(1, deltaTime * LERP_SPEED);
            local.lerpX += dx * f;
            local.lerpY += dy * f;
        }
    }

    // ── 全ユーザーのアニメーションをローカルで独立に進める ──
    const players = Ubi.player.all();
    for (const [userId] of players) {
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
    // 退出したユーザーをクリーンアップ
    for (const userId of userAnim.keys()) {
        if (!players.has(userId)) userAnim.delete(userId);
    }

    // ── 全ユーザー描画 ──
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

Ubi.registerSystem(CursorSystem);
