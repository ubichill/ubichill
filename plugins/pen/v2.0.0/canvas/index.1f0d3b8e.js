"use strict";
(() => {
  // plugins/pen/src/penFingerprint.ts
  var MAX_FINGERPRINT_CACHE = 200;
  var _committedFingerprints = /* @__PURE__ */ new Set();
  function strokeFingerprint(data) {
    const p0 = data.points[0];
    return `${data.color}|${data.size}|${data.points.length}|${p0?.[0] ?? 0},${p0?.[1] ?? 0}`;
  }
  function addCommittedFingerprint(fp) {
    if (_committedFingerprints.size >= MAX_FINGERPRINT_CACHE) {
      const oldest = _committedFingerprints.values().next().value;
      if (oldest !== void 0) _committedFingerprints.delete(oldest);
    }
    _committedFingerprints.add(fp);
  }
  function popCommittedFingerprint(fp) {
    if (_committedFingerprints.has(fp)) {
      _committedFingerprints.delete(fp);
      return true;
    }
    return false;
  }

  // plugins/pen/src/systems/PenCanvasSystem.ts
  var CANVAS_TARGET = "drawing";
  var CURSOR_RADIUS = 4;
  var _drawnEntityIds = /* @__PURE__ */ new Set();
  var PenCanvasSystem = (_entities, _dt, events) => {
    for (const event of events) {
      if (event.type === "pen:stroke_complete") {
        const { data } = event.payload;
        Ubi.canvas.commitStroke(CANVAS_TARGET, data);
        addCommittedFingerprint(strokeFingerprint(data));
      }
      if (event.type === "entity:pen:stroke") {
        const entity = event.payload;
        if (!_drawnEntityIds.has(entity.id)) {
          _drawnEntityIds.add(entity.id);
          if (!popCommittedFingerprint(strokeFingerprint(entity.data))) {
            Ubi.canvas.commitStroke(CANVAS_TARGET, entity.data);
          }
        }
      }
    }
    const isPenHeld = draw.local.heldPenId !== null;
    Ubi.canvas.frame(CANVAS_TARGET, {
      activeStroke: isPenHeld && draw.local.isDrawing && draw.local.currentStroke.length > 1 ? { points: draw.local.currentStroke, color: draw.local.color, size: draw.local.strokeWidth } : null,
      cursor: isPenHeld ? {
        x: draw.local.cursorX,
        y: draw.local.cursorY,
        color: draw.local.color,
        size: Math.max(CURSOR_RADIUS * 2, draw.local.strokeWidth),
        shape: "custom",
        // 座標原点 = カーソル先端、45° 傾き
        rotation: -Math.PI / 4,
        pathFills: [
          { d: "M0,0 L-3,-8 L3,-8 Z", fill: "#888" },
          { d: "M-3,-32 h6 v24 h-6 Z", fill: draw.local.color },
          { d: "M-2,-30 h2 v18 h-2 Z", fill: "rgba(255,255,255,0.25)" },
          { d: "M-1.5,0 a1.5,1.5 0 1,0 3,0 a1.5,1.5 0 1,0 -3,0", fill: "#333" }
        ],
        pathStrokes: [{ d: "M-3,-32 h6 v24 h-6 Z", stroke: "rgba(0,0,0,0.5)", lineWidth: 0.8 }]
      } : null
    });
  };

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

  // plugins/pen/src/systems/PenInputSystem.ts
  var PenInputSystem = (_entities, _dt, events) => {
    if (draw.local.heldPenId === null) return;
    for (const event of events) {
      if (event.type === EcsEventType.INPUT_MOUSE_MOVE) {
        const { x, y, buttons } = event.payload;
        draw.local.cursorX = x;
        draw.local.cursorY = y;
        if (draw.local.isDrawing && buttons & 1) {
          draw.local.currentStroke.push([x, y, 1]);
        }
      } else if (event.type === EcsEventType.INPUT_MOUSE_DOWN) {
        const { x, y, button } = event.payload;
        if (button === 0) {
          draw.local.isDrawing = true;
          draw.local.currentStroke = [[x, y, 1]];
        }
      } else if (event.type === EcsEventType.INPUT_MOUSE_UP) {
        const { button } = event.payload;
        if (button === 0) {
          draw.local.isDrawing = false;
        }
      }
    }
  };

  // plugins/pen/src/systems/PenSyncSystem.ts
  var CANVAS_TARGET2 = "drawing";
  var PenSyncSystem = (_entities) => {
    if (draw.local.isDrawing || draw.local.currentStroke.length <= 1) return;
    const strokeData = {
      points: draw.local.currentStroke.slice(),
      color: draw.local.color,
      size: draw.local.strokeWidth
    };
    draw.local.currentStroke = [];
    Ubi.canvas.commitStroke(CANVAS_TARGET2, strokeData);
    addCommittedFingerprint(strokeFingerprint(strokeData));
    Ubi.network.broadcast("pen:stroke_complete", strokeData);
    Ubi.world.createEntity({
      type: "pen:stroke",
      ownerId: null,
      lockedBy: null,
      transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
      data: strokeData
    }).catch((err) => {
      Ubi.log(`[PenSync] \u6C38\u7D9A\u5316\u5931\u6557: ${String(err)}`, "warn");
    });
  };

  // plugins/pen/src/systems/PenWatchSystem.ts
  var PenWatchSystem = (_entities, _dt, events) => {
    for (const event of events) {
      if (event.type !== "entity:pen:pen") continue;
      const worldEntity = event.payload;
      const data = worldEntity.data;
      const isHeldByMe = worldEntity.lockedBy === Ubi.myUserId;
      if (isHeldByMe) {
        if (draw.local.heldPenId !== worldEntity.id) {
          draw.local.isDrawing = false;
          draw.local.currentStroke = [];
        }
        draw.local.heldPenId = worldEntity.id;
        if (data.color !== void 0) draw.local.color = data.color;
        if (data.strokeWidth !== void 0) draw.local.strokeWidth = data.strokeWidth;
      } else if (worldEntity.id === draw.local.heldPenId) {
        draw.local.heldPenId = null;
        draw.local.isDrawing = false;
        draw.local.currentStroke = [];
      }
    }
  };

  // plugins/pen/src/canvas.worker.ts
  var draw = Ubi.state.define({
    heldPenId: null,
    color: "#000000",
    strokeWidth: 4,
    isDrawing: false,
    currentStroke: [],
    cursorX: 0,
    cursorY: 0
  });
  Ubi.registerSystem(PenWatchSystem);
  Ubi.registerSystem(PenInputSystem);
  Ubi.registerSystem(PenSyncSystem);
  Ubi.registerSystem(PenCanvasSystem);
  Ubi.log("[PenCanvas Worker] \u521D\u671F\u5316\u5B8C\u4E86", "info");
})();
