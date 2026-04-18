"use strict";
(() => {
  // plugins/avatar/src/state.ts
  var LERP_SPEED = 0.015;
  var SNAP_THRESHOLD = 0.1;
  var cursor = {
    lerpViewportX: 0,
    lerpViewportY: 0,
    targetViewportX: 0,
    targetViewportY: 0,
    initialized: false,
    cursorStyle: "default",
    avatar: { states: {} },
    zIndex: 10100,
    /** 現在表示中のアニメーションフレームインデックス */
    animFrame: 0,
    /** 現在フレームの経過時間 (ms) */
    animElapsed: 0,
    /** カーソル状態ごとのローカルフレーム（host から受け取る、サーバー送信しない） */
    stateFrames: {}
  };
  function resetCursor() {
    cursor.lerpViewportX = 0;
    cursor.lerpViewportY = 0;
    cursor.targetViewportX = 0;
    cursor.targetViewportY = 0;
    cursor.initialized = false;
    cursor.cursorStyle = "default";
    cursor.avatar = { states: {} };
    cursor.animFrame = 0;
    cursor.animElapsed = 0;
    cursor.stateFrames = {};
  }

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
  var AvatarCursor = () => {
    const state = cssToState(cursor.cursorStyle);
    const stateDef = cursor.avatar.states[state] ?? cursor.avatar.states.default;
    if (!stateDef?.url) return null;
    const frames = cursor.stateFrames[state];
    const frameUrl = frames && frames.length > 0 ? frames[cursor.animFrame]?.url ?? stateDef.url : stateDef.url;
    const hx = stateDef.hotspot?.x ?? 0;
    const hy = stateDef.hotspot?.y ?? 0;
    return /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "fixed",
          left: cursor.lerpViewportX - hx,
          top: cursor.lerpViewportY - hy,
          pointerEvents: "none",
          zIndex: cursor.zIndex,
          willChange: "transform"
        },
        children: /* @__PURE__ */ jsx("img", { src: frameUrl, alt: "cursor", style: { maxWidth: "64px", maxHeight: "64px", display: "block" } })
      }
    );
  };

  // plugins/avatar/src/systems/AvatarCursorSystem.tsx
  var AvatarCursorSystem = (_entities, deltaTime, events) => {
    const myUserId = Ubi.myUserId;
    for (const event of events) {
      if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
        const d = event.payload;
        if (!cursor.initialized) {
          cursor.lerpViewportX = d.viewportX;
          cursor.lerpViewportY = d.viewportY;
          cursor.initialized = true;
        }
        cursor.targetViewportX = d.viewportX;
        cursor.targetViewportY = d.viewportY;
      }
      if (event.type === EcsEventType.INPUT_CURSOR_STYLE) {
        const d = event.payload;
        if (d.style !== cursor.cursorStyle) {
          cursor.cursorStyle = d.style;
          cursor.animFrame = 0;
          cursor.animElapsed = 0;
        }
      }
      if (event.type === EcsEventType.PLAYER_JOINED) {
        const user = event.payload;
        if (user.id === myUserId && user.avatar) {
          cursor.avatar = user.avatar;
          cursor.stateFrames = {};
          cursor.animFrame = 0;
          cursor.animElapsed = 0;
          const sourceUrls = Object.entries(user.avatar.states).reduce((acc, [state, def]) => {
            if (def?.sourceUrl) {
              acc.push({ state, sourceUrl: def.sourceUrl });
            }
            return acc;
          }, []);
          if (sourceUrls.length > 0) {
            Ubi.network.sendToHost("avatar:requestFrames", { sourceUrls });
          }
        }
      }
      if (event.type === EcsEventType.HOST_MESSAGE) {
        const m = event.payload;
        if (m.type === "avatar:localFrames") {
          const { framesMap } = m.payload;
          cursor.stateFrames = framesMap;
          cursor.animFrame = 0;
          cursor.animElapsed = 0;
        }
      }
    }
    if (cursor.initialized) {
      const dvx = cursor.targetViewportX - cursor.lerpViewportX;
      const dvy = cursor.targetViewportY - cursor.lerpViewportY;
      if (Math.abs(dvx) < SNAP_THRESHOLD && Math.abs(dvy) < SNAP_THRESHOLD) {
        cursor.lerpViewportX = cursor.targetViewportX;
        cursor.lerpViewportY = cursor.targetViewportY;
      } else {
        const f = Math.min(1, deltaTime * LERP_SPEED);
        cursor.lerpViewportX += dvx * f;
        cursor.lerpViewportY += dvy * f;
      }
    }
    const currentState = cssToState(cursor.cursorStyle);
    const frames = cursor.stateFrames[currentState];
    if (frames && frames.length > 1) {
      cursor.animElapsed += deltaTime;
      const frameDuration = frames[cursor.animFrame]?.duration ?? 100;
      if (cursor.animElapsed >= frameDuration) {
        cursor.animElapsed -= frameDuration;
        cursor.animFrame = (cursor.animFrame + 1) % frames.length;
      }
    } else {
      cursor.animFrame = 0;
    }
    Ubi.ui.renderEntity(`user:${myUserId ?? "unknown"}`, "cursor", () => /* @__PURE__ */ jsx(AvatarCursor, {}));
  };

  // plugins/avatar/src/cursor.worker.tsx
  resetCursor();
  void (async () => {
    try {
      const entities = await Ubi.world.queryEntities("avatar:cursor");
      if (entities.length > 0) {
        cursor.zIndex = entities[0].transform.z;
        Ubi.log(`[Avatar Cursor] zIndex: ${entities[0].transform.z}`, "info");
      }
    } catch {
    }
  })();
  Ubi.registerSystem(AvatarCursorSystem);
  Ubi.log("initialized", "info");
})();
