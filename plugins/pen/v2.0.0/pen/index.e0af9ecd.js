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

  // plugins/pen/src/pen.worker.tsx
  var pen = Ubi.state.define({
    color: Ubi.state.sync("#1a1a1a"),
    strokeWidth: Ubi.state.sync(4)
  });
  var grip = Ubi.grip.exclusive();
  grip.onChange((next, prev) => {
    if (next === Ubi.myUserId && prev !== Ubi.myUserId) {
      PenEvents.sendToHost("user:update", { penColor: pen.local.color });
    } else if (prev === Ubi.myUserId && next !== Ubi.myUserId) {
      PenEvents.sendToHost("user:update", { penColor: null });
    }
  });
  var renderPen = () => {
    const heldBy = grip.holder;
    const isHeldByMe = grip.isMine;
    const isHeldByOther = heldBy !== null && !isHeldByMe;
    const color = pen.local.color;
    Ubi.ui.render(
      () => /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          title: isHeldByOther ? "\u4F7F\u7528\u4E2D" : color,
          disabled: isHeldByOther,
          onUbiClick: () => {
            if (isHeldByOther) return;
            if (isHeldByMe) grip.release();
            else grip.acquire();
          },
          style: {
            width: "36px",
            height: "48px",
            borderRadius: "8px",
            border: isHeldByMe ? `2px solid ${color}` : "2px solid transparent",
            background: isHeldByMe ? `${color}22` : "rgba(0,0,0,0.04)",
            cursor: isHeldByOther ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px",
            transition: "all 0.15s",
            opacity: isHeldByOther ? 0.35 : isHeldByMe ? 0.4 : 1,
            pointerEvents: "auto"
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
                fill: color,
                stroke: "rgba(0,0,0,0.2)",
                strokeWidth: "0.8"
              }
            ),
            /* @__PURE__ */ jsx("rect", { x: "6", y: "6", width: "2.5", height: "14", rx: "1", fill: "rgba(255,255,255,0.3)" }),
            /* @__PURE__ */ jsx("rect", { x: "5", y: "1", width: "8", height: "5", rx: "1.5", fill: "rgba(0,0,0,0.2)" })
          ] })
        }
      ),
      "pen-button"
    );
  };
  pen.onChange("color", renderPen);
  pen.onChange("strokeWidth", renderPen);
  grip.onChange(renderPen);
  renderPen();
})();
