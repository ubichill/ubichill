"use strict";
(() => {
  // mods/pen/src/events.ts
  var PenEvents = Ubi.event.define();

  // mods/pen/src/canvas.worker.ts
  var CANVAS_TARGET = "drawing";
  var MAX_FINGERPRINT_CACHE = 200;
  var draw = Ubi.state.define({
    /** 保持中ペンの ComponentInstance.id (Worker 識別子)。null なら未保持。 */
    heldPenId: null,
    /** 保持中ペンの Entity (GameObject) id。stroke の親に使う。 */
    heldPenEntityId: null,
    color: "#000000",
    strokeWidth: 4,
    isDrawing: false,
    currentStroke: [],
    cursorX: 0,
    cursorY: 0
  });
  var remoteHeld = /* @__PURE__ */ new Map();
  var committedFingerprints = /* @__PURE__ */ new Set();
  var drawnEntityIds = /* @__PURE__ */ new Set();
  var strokeFingerprint = (data) => {
    const p0 = data.points[0];
    return `${data.color}|${data.size}|${data.points.length}|${p0?.[0] ?? 0},${p0?.[1] ?? 0}`;
  };
  var addFingerprint = (fp) => {
    if (committedFingerprints.size >= MAX_FINGERPRINT_CACHE) {
      const oldest = committedFingerprints.values().next().value;
      if (oldest !== void 0) committedFingerprints.delete(oldest);
    }
    committedFingerprints.add(fp);
  };
  var popFingerprintIfExists = (fp) => {
    if (!committedFingerprints.has(fp)) return false;
    committedFingerprints.delete(fp);
    return true;
  };
  var buildActiveStroke = () => {
    if (!draw.local.isDrawing || draw.local.currentStroke.length <= 1) return null;
    return { points: draw.local.currentStroke, color: draw.local.color, size: draw.local.strokeWidth };
  };
  PenEvents.on("entity:pen:pen", (pen) => {
    if (!pen) return;
    const isHeldByMe = pen.lockedBy === Ubi.myUserId;
    if (isHeldByMe) {
      if (draw.local.heldPenId !== pen.id) {
        draw.batch(() => {
          draw.local.isDrawing = false;
          draw.local.currentStroke = [];
        });
      }
      draw.batch(() => {
        draw.local.heldPenId = pen.id;
        draw.local.heldPenEntityId = pen.entityId ?? null;
        if (pen.data.color !== void 0) draw.local.color = pen.data.color;
        if (pen.data.strokeWidth !== void 0) draw.local.strokeWidth = pen.data.strokeWidth;
      });
    } else if (pen.id === draw.local.heldPenId) {
      draw.batch(() => {
        draw.local.heldPenId = null;
        draw.local.heldPenEntityId = null;
        draw.local.isDrawing = false;
        draw.local.currentStroke = [];
      });
    }
    for (const [userId, info] of remoteHeld) {
      if (info.penId === pen.id) {
        remoteHeld.delete(userId);
        break;
      }
    }
    if (pen.lockedBy && pen.lockedBy !== Ubi.myUserId) {
      remoteHeld.set(pen.lockedBy, {
        penId: pen.id,
        color: pen.data.color ?? "#000000",
        strokeWidth: pen.data.strokeWidth ?? 4
      });
    }
  });
  PenEvents.on("input:mouse_move", ({ x, y, buttons }) => {
    if (draw.local.heldPenId === null) return;
    draw.local.cursorX = x;
    draw.local.cursorY = y;
    if (draw.local.isDrawing && buttons & 1) draw.local.currentStroke.push([x, y, 1]);
  });
  PenEvents.on("input:mouse_down", ({ x, y, button }) => {
    if (draw.local.heldPenId === null || button !== 0) return;
    draw.batch(() => {
      draw.local.isDrawing = true;
      draw.local.currentStroke = [[x, y, 1]];
    });
  });
  PenEvents.on("input:mouse_up", ({ button }) => {
    if (draw.local.heldPenId === null || button !== 0) return;
    draw.local.isDrawing = false;
  });
  PenEvents.onBroadcast("pen:stroke_complete", (_userId, data) => {
    Ubi.canvas.commitStroke(CANVAS_TARGET, data);
    addFingerprint(strokeFingerprint(data));
  });
  PenEvents.on("entity:pen:stroke", (entity) => {
    if (drawnEntityIds.has(entity.id)) return;
    drawnEntityIds.add(entity.id);
    if (!popFingerprintIfExists(strokeFingerprint(entity.data))) {
      Ubi.canvas.commitStroke(CANVAS_TARGET, entity.data);
    }
  });
  var flushCompletedStroke = () => {
    if (draw.local.isDrawing || draw.local.currentStroke.length <= 1) return;
    const strokeData = {
      points: draw.local.currentStroke.slice(),
      color: draw.local.color,
      size: draw.local.strokeWidth
    };
    draw.local.currentStroke = [];
    Ubi.canvas.commitStroke(CANVAS_TARGET, strokeData);
    addFingerprint(strokeFingerprint(strokeData));
    PenEvents.broadcast("pen:stroke_complete", strokeData);
    const parentEntityId = draw.local.heldPenEntityId ?? void 0;
    const strokeEntityId = parentEntityId ? `stroke-${crypto.randomUUID()}` : void 0;
    Ubi.entity.spawn({
      type: "pen:stroke",
      entityId: strokeEntityId,
      parentEntityId,
      ownerId: null,
      lockedBy: null,
      transform: { x: 0, y: 0, z: 0, w: 0, h: 0, scale: 1, rotation: 0 },
      data: strokeData
    }).catch((err) => Ubi.log(`[pen:canvas] \u6C38\u7D9A\u5316\u5931\u6557: ${String(err)}`, "warn"));
  };
  var FrameSystem = (_entities) => {
    flushCompletedStroke();
    Ubi.canvas.frame(CANVAS_TARGET, {
      activeStroke: buildActiveStroke(),
      cursors: []
      // ペン本体（pen:pen）が追従するため、キャンバス側でのダミーカーソル描画は不要
    });
  };
  Ubi.registerSystem(FrameSystem);
})();
