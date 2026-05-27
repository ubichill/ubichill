"use strict";
(() => {
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

  // plugins/pen/src/tray.worker.tsx
  var SIZES = [2, 4, 8, 16];
  var knownPens = /* @__PURE__ */ new Map();
  var setSize = (id, size) => {
    const p = knownPens.get(id);
    if (!p) return;
    Ubi.entity(id).update({ data: { ...p.data, strokeWidth: size } }).catch((err) => Ubi.log(`[pen:tray] \u30B5\u30A4\u30BA\u5909\u66F4\u5931\u6557: ${String(err)}`, "warn"));
  };
  var findHeldByMe = () => {
    const myId = Ubi.myUserId;
    if (!myId) return null;
    for (const p of knownPens.values()) if (p.lockedBy === myId) return p;
    return null;
  };
  var renderTray = () => {
    const held = findHeldByMe();
    const color = held?.data.color ?? "#888";
    const currentSize = held?.data.strokeWidth ?? 4;
    Ubi.ui.render(
      () => /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            position: "absolute",
            inset: "0",
            backgroundColor: "rgba(245,245,247,0.92)",
            borderRadius: "12px",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid rgba(0,0,0,0.08)",
            userSelect: "none",
            pointerEvents: "none"
          },
          children: held && /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                position: "absolute",
                left: "0",
                right: "0",
                bottom: "8px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "4px",
                padding: "0 4px",
                pointerEvents: "auto"
              },
              children: SIZES.map((s) => {
                const isSelected = currentSize === s;
                return /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    title: `${s}px`,
                    style: {
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      border: isSelected ? `2px solid ${color}` : "2px solid rgba(0,0,0,0.15)",
                      background: isSelected ? `${color}22` : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "0",
                      transition: "all 0.15s"
                    },
                    onUbiClick: () => setSize(held.id, s),
                    children: /* @__PURE__ */ jsx(
                      "div",
                      {
                        style: {
                          width: Math.min(s * 1.5, 14),
                          height: Math.min(s * 1.5, 14),
                          borderRadius: "50%",
                          background: isSelected ? color : "rgba(0,0,0,0.4)"
                        }
                      }
                    )
                  },
                  String(s)
                );
              })
            }
          )
        }
      ),
      "pen-tray"
    );
  };
  var ingestEvent = (event) => {
    if (event.type !== "entity:pen:pen") return false;
    const e = event.payload;
    if (!e) return false;
    const prev = knownPens.get(e.id);
    const next = {
      id: e.id,
      lockedBy: e.lockedBy ?? null,
      data: { color: e.data.color, strokeWidth: e.data.strokeWidth }
    };
    if (prev && prev.lockedBy === next.lockedBy && prev.data.color === next.data.color && prev.data.strokeWidth === next.data.strokeWidth) {
      return false;
    }
    knownPens.set(e.id, next);
    return true;
  };
  var PenTraySystem = (_entities, _dt, events) => {
    const changed = events.reduce((acc, ev) => ingestEvent(ev) || acc, false);
    if (changed) renderTray();
  };
  Ubi.registerSystem(PenTraySystem);
  renderTray();
})();
