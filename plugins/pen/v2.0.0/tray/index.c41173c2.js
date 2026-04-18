"use strict";
(() => {
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
  function jsxs(type, props, key) {
    const { children, ...rest } = props;
    return makeVNode(type, rest, children ?? [], key);
  }

  // plugins/pen/src/tray.worker.tsx
  var penEntities = /* @__PURE__ */ new Map();
  var trayZIndex = 0;
  var trayDirty = false;
  var SIZES = [2, 4, 8, 16];
  void (async () => {
    const entityId = Ubi.entityId;
    if (entityId) {
      try {
        const trayEntity = await Ubi.world.getEntity(entityId);
        if (trayEntity) {
          trayZIndex = trayEntity.transform.z ?? trayZIndex;
        }
      } catch {
      }
    }
    try {
      const pens = await Ubi.world.queryEntities("pen:pen");
      for (const pen of pens) {
        penEntities.set(pen.id, {
          id: pen.id,
          data: pen.data,
          lockedBy: pen.lockedBy ?? null,
          z: pen.transform.z ?? 0
        });
      }
      trayDirty = true;
      Ubi.log(`[PenTray] \u521D\u671F\u5316\u5B8C\u4E86: ${penEntities.size} \u30DA\u30F3, zIndex=${trayZIndex}`, "info");
    } catch (err) {
      Ubi.log(`[PenTray] \u30DA\u30F3\u4E00\u89A7\u53D6\u5F97\u5931\u6557: ${String(err)}`, "warn");
    }
  })();
  async function selectPen(penId) {
    const myId = Ubi.myUserId;
    if (!myId) return;
    for (const pen2 of penEntities.values()) {
      if (pen2.id === penId) continue;
      if (pen2.lockedBy === myId) {
        await Ubi.world.updateEntity(pen2.id, { lockedBy: null });
      }
    }
    await Ubi.world.updateEntity(penId, { lockedBy: myId });
    const pen = penEntities.get(penId);
    if (pen) {
      Ubi.network.sendToHost("user:update", { penColor: pen.data.color });
    }
  }
  async function releasePen(penId) {
    const pen = penEntities.get(penId);
    if (pen?.lockedBy === Ubi.myUserId) {
      await Ubi.world.updateEntity(penId, { lockedBy: null });
      Ubi.network.sendToHost("user:update", { penColor: null });
    }
  }
  async function setSize(penId, size) {
    const pen = penEntities.get(penId);
    if (!pen || pen.lockedBy !== Ubi.myUserId) return;
    await Ubi.world.updateEntity(penId, { data: { ...pen.data, strokeWidth: size } });
  }
  function renderTray() {
    const myId = Ubi.myUserId;
    const pens = Array.from(penEntities.values()).sort((a, b) => a.z - b.z);
    const heldPen = pens.find((p) => p.lockedBy === myId) ?? null;
    Ubi.ui.render(
      () => /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            width: "max-content",
            backgroundColor: "rgba(255,255,255,0.55)",
            borderRadius: "12px",
            boxShadow: "inset 0 2px 5px rgba(0,0,0,0.1), 0 4px 16px rgba(0,0,0,0.12)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.7)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: "4px",
            zIndex: trayZIndex,
            pointerEvents: "auto",
            userSelect: "none"
          },
          children: [
            pens.map((pen) => {
              const isSelectedByMe = pen.lockedBy === myId;
              const isLockedByOther = pen.lockedBy !== null && pen.lockedBy !== myId;
              return /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  title: isLockedByOther ? `\u4F7F\u7528\u4E2D` : pen.data.color,
                  style: {
                    width: "36px",
                    height: "48px",
                    borderRadius: "8px",
                    border: isSelectedByMe ? `2px solid ${pen.data.color}` : "2px solid transparent",
                    background: isSelectedByMe ? `${pen.data.color}22` : "rgba(0,0,0,0.04)",
                    cursor: isLockedByOther ? "not-allowed" : "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "4px",
                    padding: "4px",
                    transition: "all 0.15s",
                    opacity: isLockedByOther ? 0.35 : 1
                  },
                  onUbiClick: () => {
                    if (isLockedByOther) return;
                    if (isSelectedByMe) {
                      void releasePen(pen.id);
                    } else {
                      void selectPen(pen.id);
                    }
                  },
                  children: /* @__PURE__ */ jsxs("svg", { width: "18", height: "32", viewBox: "0 0 18 32", style: { display: "block" }, children: [
                    /* @__PURE__ */ jsx("polygon", { points: "9,32 5,24 13,24", fill: "#888" }),
                    /* @__PURE__ */ jsx(
                      "rect",
                      {
                        x: "5",
                        y: "4",
                        width: "8",
                        height: "20",
                        rx: "2",
                        fill: pen.data.color,
                        stroke: "rgba(0,0,0,0.2)",
                        strokeWidth: "0.8"
                      }
                    ),
                    /* @__PURE__ */ jsx("rect", { x: "6", y: "6", width: "2.5", height: "14", rx: "1", fill: "rgba(255,255,255,0.3)" }),
                    /* @__PURE__ */ jsx("rect", { x: "5", y: "1", width: "8", height: "5", rx: "1.5", fill: "rgba(0,0,0,0.2)" })
                  ] })
                },
                pen.id
              );
            }),
            pens.length > 0 && /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  width: "1px",
                  height: "36px",
                  backgroundColor: "rgba(0,0,0,0.15)",
                  margin: "0 4px",
                  flexShrink: "0"
                }
              }
            ),
            heldPen && SIZES.map((s) => {
              const isSelected = heldPen.data.strokeWidth === s;
              return /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  title: `${s}px`,
                  style: {
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    border: isSelected ? `2px solid ${heldPen.data.color}` : "2px solid rgba(0,0,0,0.15)",
                    background: isSelected ? `${heldPen.data.color}22` : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0",
                    transition: "all 0.15s"
                  },
                  onUbiClick: () => {
                    void setSize(heldPen.id, s);
                  },
                  children: /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        width: Math.min(s * 1.5, 22),
                        height: Math.min(s * 1.5, 22),
                        borderRadius: "50%",
                        background: isSelected ? heldPen.data.color : "rgba(0,0,0,0.4)"
                      }
                    }
                  )
                },
                String(s)
              );
            })
          ]
        }
      ),
      "pen-tray"
    );
  }
  var PenTraySystem = (_entities, _dt, events) => {
    for (const event of events) {
      if (event.type === "entity:pen:pen") {
        const worldEntity = event.payload;
        penEntities.set(worldEntity.id, {
          id: worldEntity.id,
          data: worldEntity.data,
          lockedBy: worldEntity.lockedBy ?? null,
          z: worldEntity.transform.z ?? 0
        });
        trayDirty = true;
      }
    }
    if (!trayDirty) return;
    trayDirty = false;
    renderTray();
  };
  Ubi.registerSystem(PenTraySystem);
  console.log("[PenTray Worker] Initialized.");
})();
