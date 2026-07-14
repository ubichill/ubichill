"use strict";
(() => {
  // plugins/avatar/src/cssToState.ts
  function cssToState(css) {
    if (css === "pointer") return "pointer";
    if (css === "text" || css === "vertical-text") return "text";
    if (css === "wait" || css === "progress") return "wait";
    if (css === "help") return "help";
    if (css === "not-allowed" || css === "no-drop") return "not-allowed";
    if (css === "move") return "move";
    if (css === "grabbing") return "grabbing";
    return "default";
  }

  // plugins/avatar/src/events.ts
  var AvatarEvents = Ubi.event.define();

  // packages/sdk/src/jsx/jsx-runtime.ts
  var Fragment = "ubichill:fragment";
  var _SHARED_KEY = "__ubichill_jsx_state";
  function _getState() {
    const g = globalThis;
    if (!g[_SHARED_KEY]) {
      g[_SHARED_KEY] = {
        handlersMap: /* @__PURE__ */ new Map(),
        currentTargetId: "default",
        handlerIdx: 0
      };
    }
    return g[_SHARED_KEY];
  }
  function serializeProps(rawProps) {
    const result = {};
    for (const key of Object.keys(rawProps)) {
      if (key === "children") continue;
      const val = rawProps[key];
      if (key.startsWith("onUbi") && typeof val === "function") {
        const s = _getState();
        const handlers = s.handlersMap.get(s.currentTargetId);
        if (handlers) {
          const idx = s.handlerIdx++;
          handlers[idx] = val;
          result[key] = `__h${idx}`;
        }
      } else if (val !== void 0) {
        result[key] = val;
      }
    }
    return result;
  }
  function flattenChildren(raw) {
    if (!Array.isArray(raw)) return [raw];
    const out = [];
    for (const item of raw) {
      if (Array.isArray(item)) {
        for (const sub of item) out.push(sub);
      } else {
        out.push(item);
      }
    }
    return out;
  }
  function makeVNode(type, props, children, key) {
    if (typeof type === "function") {
      const childProp = children.length === 1 ? children[0] : children.length === 0 ? void 0 : children;
      const result = type({ ...props, children: childProp });
      return result ?? { type: Fragment, props: {}, children: [], key: null };
    }
    return { type, props: serializeProps(props), children, key: key ?? null };
  }
  function jsx(type, props, key) {
    const { children, ...rest } = props;
    return makeVNode(type, rest, children !== void 0 ? flattenChildren(children) : [], key);
  }

  // plugins/avatar/src/ui/AvatarCursor.tsx
  var CursorImage = ({ viewportX, viewportY, url, hotspot, zIndex }) => {
    const hx = hotspot?.x ?? 0;
    const hy = hotspot?.y ?? 0;
    return /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "fixed",
          left: viewportX - hx,
          top: viewportY - hy,
          pointerEvents: "none",
          zIndex,
          willChange: "transform"
        },
        children: /* @__PURE__ */ jsx("img", { src: url, alt: "", style: { maxWidth: "64px", maxHeight: "64px", display: "block" } })
      }
    );
  };

  // plugins/avatar/src/cursor.worker.tsx
  var LERP_SPEED = 0.015;
  var SNAP_THRESHOLD = 0.1;
  var DEFAULT_Z = 10100;
  var cursor = Ubi.state.define({
    // ローカル専用 (lerp / アニメーション / 表示制御)
    lerpX: 0,
    lerpY: 0,
    targetX: 0,
    targetY: 0,
    initialized: false,
    localCursorStyle: "default",
    zIndex: DEFAULT_Z,
    // 全ユーザー共有 (presence 経由)
    cursorState: Ubi.state.sync("default", { ephemeral: true }),
    avatar: Ubi.state.sync(null, { ephemeral: true })
  });
  var framesCache = /* @__PURE__ */ new Map();
  var requestedUrls = /* @__PURE__ */ new Set();
  var pendingRequests = [];
  var userAnim = /* @__PURE__ */ new Map();
  function ensureFrames(avatar) {
    const toRequest = [];
    for (const [state, def] of Object.entries(avatar.states)) {
      if (def?.sourceUrl && !requestedUrls.has(def.sourceUrl)) {
        requestedUrls.add(def.sourceUrl);
        toRequest.push({ state, sourceUrl: def.sourceUrl });
      }
    }
    if (toRequest.length === 0) return;
    pendingRequests.push(toRequest);
    AvatarEvents.sendToHost("avatar:requestFrames", { sourceUrls: toRequest });
  }
  function getFrames(avatar, state) {
    const stateDef = avatar.states[state] ?? avatar.states.default;
    return stateDef?.sourceUrl ? framesCache.get(stateDef.sourceUrl) : void 0;
  }
  void (async () => {
    const [self] = await Ubi.entity.query("avatar:cursor");
    if (self) cursor.local.zIndex = self.transform.z;
  })();
  Ubi.player.syncCursor({ throttleMs: 50 });
  AvatarEvents.on("input:cursor_style", ({ style }) => {
    if (style === cursor.local.localCursorStyle) return;
    cursor.local.localCursorStyle = style;
    cursor.local.cursorState = cssToState(style);
  });
  AvatarEvents.on("input:mouse_move", ({ viewportX, viewportY }) => {
    const { local } = cursor;
    if (!local.initialized) {
      local.lerpX = viewportX;
      local.lerpY = viewportY;
      local.initialized = true;
    }
    local.targetX = viewportX;
    local.targetY = viewportY;
  });
  AvatarEvents.on("player:joined", (user) => {
    if (user.id !== Ubi.myUserId || !user.avatar) return;
    cursor.local.avatar = user.avatar;
    cursor.local.cursorState = "default";
    ensureFrames(user.avatar);
  });
  AvatarEvents.on("avatar:localFrames", ({ framesMap }) => {
    const batch = pendingRequests.shift();
    if (!batch) return;
    for (const { state, sourceUrl } of batch) {
      const frames = framesMap[state];
      if (frames) framesCache.set(sourceUrl, frames);
    }
  });
  var CursorSystem = (_entities, deltaTime) => {
    const { local } = cursor;
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
    for (const userId of userAnim.keys()) {
      if (!players.has(userId)) userAnim.delete(userId);
    }
    cursor.renderForEachUser("cursor", (state) => {
      const isSelf = state.id === Ubi.myUserId;
      const viewportX = isSelf ? local.lerpX : state.viewportX;
      const viewportY = isSelf ? local.lerpY : state.viewportY;
      const { avatar, cursorState } = state;
      if (!avatar) return null;
      const avatarState = cssToState(cursorState);
      const stateDef = avatar.states[avatarState] ?? avatar.states.default;
      if (!stateDef?.url) return null;
      const frames = getFrames(avatar, avatarState);
      const anim = userAnim.get(state.id);
      const url = frames && frames.length > 0 && anim ? frames[anim.frame]?.url ?? stateDef.url : stateDef.url;
      return /* @__PURE__ */ jsx(
        CursorImage,
        {
          viewportX,
          viewportY,
          url,
          hotspot: stateDef.hotspot,
          zIndex: isSelf ? local.zIndex : local.zIndex - 1
        }
      );
    });
  };
  Ubi.registerSystem(CursorSystem);
})();
