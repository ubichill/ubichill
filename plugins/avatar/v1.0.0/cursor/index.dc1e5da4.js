"use strict";
(() => {
  // packages/engine/src/ecs/types.ts
  var EcsEventType = {
    PLAYER_JOINED: "player:joined",
    PLAYER_LEFT: "player:left",
    PLAYER_CURSOR_MOVED: "player:cursor_moved",
    ENTITY_UPDATED: "entity:updated",
    /** 入力イベント — Host が毎フレーム全 Worker へ配信 */
    INPUT_MOUSE_MOVE: "input:mouse_move",
    INPUT_MOUSE_DOWN: "input:mouse_down",
    INPUT_MOUSE_UP: "input:mouse_up",
    INPUT_KEY_DOWN: "input:key_down",
    INPUT_KEY_UP: "input:key_up",
    /** 右クリック（コンテキストメニュー）— payload: { x, y } */
    INPUT_CONTEXT_MENU: "input:context_menu",
    /** スクロール — payload: { x: scrollLeft, y: scrollTop } */
    INPUT_SCROLL: "input:scroll",
    /** ウィンドウリサイズ — payload: { width: number; height: number } */
    INPUT_RESIZE: "input:resize",
    /** カーソルスタイル変化 — payload: { style: string } */
    INPUT_CURSOR_STYLE: "input:cursor_style",
    /**
     * 他ユーザーの Worker が Ubi.network.broadcast() で送ったデータ。
     * payload: { userId: string; data: unknown }
     * event.type が broadcast の type 文字列になるため、このキーで比較するのではなく
     * broadcast 時に指定した type 文字列で比較すること。
     */
    NETWORK_BROADCAST: "network:broadcast",
    /** OffscreenCanvas のリサイズ通知。payload: { targetId: string; width: number; height: number } */
    CANVAS_RESIZE: "canvas:resize",
    /**
     * Host からプラグイン Worker へのカスタムメッセージ。
     * payload: { type: string; payload: unknown }
     * GenericPluginHost の sendHostMessage() で送信する。
     */
    HOST_MESSAGE: "host:message"
  };

  // packages/sandbox/src/guest/jsx-runtime.ts
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

  // plugins/avatar/src/systems/utils.ts
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

  // plugins/avatar/src/systems/AvatarCursorSystem.tsx
  var LERP_SPEED = 0.015;
  var SNAP_THRESHOLD = 0.1;
  var cursor = Ubi.state.define(
    {
      // ローカル専用（lerp・アニメーション・表示制御）
      lerpX: 0,
      lerpY: 0,
      targetX: 0,
      targetY: 0,
      initialized: false,
      localCursorStyle: "default",
      zIndex: 10100,
      // グローバル同期（全ユーザーに配布）
      cursorState: "default",
      avatar: null
    },
    ["cursorState", "avatar"]
  );
  var framesCache = /* @__PURE__ */ new Map();
  var requestedUrls = /* @__PURE__ */ new Set();
  var pendingRequests = [];
  var userAnim = /* @__PURE__ */ new Map();
  function setZIndex(z) {
    cursor.local.zIndex = z;
  }
  function ensureFrames(avatar) {
    const toRequest = [];
    for (const [state, def] of Object.entries(avatar.states)) {
      if (def?.sourceUrl && !requestedUrls.has(def.sourceUrl)) {
        requestedUrls.add(def.sourceUrl);
        toRequest.push({ state, sourceUrl: def.sourceUrl });
      }
    }
    if (toRequest.length > 0) {
      pendingRequests.push(toRequest);
      Ubi.network.sendToHost("avatar:requestFrames", { sourceUrls: toRequest });
    }
  }
  function getFrames(avatar, state) {
    const stateDef = avatar.states[state] ?? avatar.states.default;
    return stateDef?.sourceUrl ? framesCache.get(stateDef.sourceUrl) : void 0;
  }
  var AvatarCursorSystem = (_entities, deltaTime, events) => {
    const { local } = cursor;
    for (const event of events) {
      if (event.type === EcsEventType.INPUT_CURSOR_STYLE) {
        const d = event.payload;
        if (d.style !== local.localCursorStyle) {
          local.localCursorStyle = d.style;
          cursor.set({ cursorState: cssToState(d.style) });
        }
      }
      if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
        const d = event.payload;
        if (!local.initialized) {
          local.lerpX = d.viewportX;
          local.lerpY = d.viewportY;
          local.initialized = true;
        }
        local.targetX = d.viewportX;
        local.targetY = d.viewportY;
      }
      if (event.type === EcsEventType.PLAYER_JOINED) {
        const user = event.payload;
        if (user.id === Ubi.myUserId && user.avatar) {
          cursor.set({ avatar: user.avatar, cursorState: "default" });
          ensureFrames(user.avatar);
        }
      }
      if (event.type === EcsEventType.HOST_MESSAGE) {
        const m = event.payload;
        if (m.type === "avatar:localFrames") {
          const { framesMap } = m.payload;
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

  // plugins/avatar/src/cursor.worker.tsx
  Ubi.presence.syncPosition({ throttleMs: 50 });
  void (async () => {
    try {
      const entities = await Ubi.world.queryEntities("avatar:cursor");
      if (entities.length > 0) {
        setZIndex(entities[0].transform.z);
        Ubi.log(`[Avatar Cursor] zIndex: ${entities[0].transform.z}`, "info");
      }
    } catch {
    }
  })();
  Ubi.registerSystem(AvatarCursorSystem);
  Ubi.log("initialized", "info");
})();
