"use strict";
(() => {
  // plugins/pen/src/events.ts
  var PenEvents = Ubi.event.define();

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
  function jsxs(type, props, key) {
    const { children, ...rest } = props;
    return makeVNode(type, rest, children ?? [], key);
  }

  // plugins/pen/src/tray.worker.tsx
  var THICKNESS_OPTIONS = [2, 4, 8, 12];
  Ubi.ui.render(
    () => /* @__PURE__ */ jsxs("div", { style: { position: "absolute", inset: "0", pointerEvents: "none" }, children: [
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onUbiClick: async () => {
            if (!Ubi.componentInstanceId) return;
            const tray = await Ubi.entity.get(Ubi.componentInstanceId);
            if (!tray) return;
            PenEvents.emit(
              "pen:tray:release",
              { x: tray.transform.x, y: tray.transform.y },
              { scope: "world", targetType: "pen:pen" }
            );
          },
          onUbiPointerDown: () => {
          },
          style: {
            position: "absolute",
            inset: "0",
            padding: 0,
            backgroundColor: "rgba(245,245,247,0.92)",
            borderRadius: "12px",
            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid rgba(0,0,0,0.08)",
            userSelect: "none",
            pointerEvents: "auto",
            cursor: "pointer"
          }
        }
      ),
      /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            position: "absolute",
            top: "0",
            left: "100%",
            marginLeft: "16px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            pointerEvents: "none"
          },
          children: THICKNESS_OPTIONS.map((thickness) => /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onUbiClick: () => {
                PenEvents.emit(
                  "pen:tray:change_thickness",
                  { thickness },
                  { scope: "world", targetType: "pen:pen" }
                );
              },
              onUbiPointerDown: () => {
              },
              style: {
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                border: "1px solid rgba(0,0,0,0.1)",
                backgroundColor: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                pointerEvents: "auto",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)"
              },
              children: /* @__PURE__ */ jsx(
                "div",
                {
                  style: {
                    width: thickness,
                    height: thickness,
                    borderRadius: "50%",
                    backgroundColor: "#1a1a1a"
                  }
                }
              )
            }
          ))
        }
      )
    ] }),
    "pen-tray"
  );
})();
