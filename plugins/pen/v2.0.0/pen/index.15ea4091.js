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
  function jsxs(type, props, key) {
    const { children, ...rest } = props;
    return makeVNode(type, rest, children ?? [], key);
  }

  // packages/sdk/src/jsx/Gripable.tsx
  function Gripable({ grip: grip2, children, style }) {
    const opts = grip2.options;
    const isMine = grip2.isMine;
    const isBlocked = grip2.isHeldByOther;
    const stateOpacity = isBlocked ? opts.blockedByOther?.opacity ?? 0.35 : isMine ? opts.held?.opacity ?? 1 : 1;
    const cursor = isBlocked ? "not-allowed" : isMine ? opts.hover?.heldCursor ?? "grabbing" : opts.hover?.cursor ?? "grab";
    const hoverScaleValue = !isMine && !isBlocked ? opts.hover?.scale ?? 1 : 1;
    const inlineStyle = {
      ...style ? Object.fromEntries(Object.entries(style).filter(([, v]) => v !== void 0)) : {},
      cursor,
      opacity: stateOpacity,
      background: "transparent",
      border: opts.hover?.outline ?? "none",
      padding: 0,
      pointerEvents: isMine && opts.mode === "manual" ? "none" : "auto",
      transition: "opacity 0.12s ease, transform 0.12s ease, outline-color 0.12s ease",
      "--ubi-gripable-scale": String(hoverScaleValue)
    };
    return /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        "data-ubi-gripable": true,
        disabled: isBlocked,
        onUbiClick: () => grip2.toggle(),
        style: inlineStyle,
        children
      }
    );
  }

  // plugins/pen/src/events.ts
  var PenEvents = Ubi.event.define();

  // plugins/pen/src/pen.worker.tsx
  var pen = Ubi.state.define({
    color: Ubi.state.sync("#1a1a1a"),
    strokeWidth: Ubi.state.sync(4)
  });
  var grip = Ubi.grip.exclusive({
    mode: "manual",
    hover: {
      cursor: "grab",
      heldCursor: "grabbing",
      scale: 1.15
    },
    blockedByOther: { opacity: 0.35 },
    offset: { x: -18, y: -24 },
    share: "persistent",
    // 持った時に他のペンより手前に。リリース後もこの z は永続するので
    // 「最後に触ったペンが一番上」状態が保たれて子要素間の z が逆転しない
    bringToFront: true
  });
  PenEvents.on("pen:tray:release", (coords) => {
    if (grip.isMine) grip.release(coords);
  });
  PenEvents.on("pen:tray:change_thickness", ({ thickness }) => {
    if (grip.isMine) {
      pen.local.strokeWidth = thickness;
    }
  });
  grip.onChange((next, prev) => {
    if (next === Ubi.myUserId && prev !== Ubi.myUserId) {
      PenEvents.sendToHost("user:update", { penColor: pen.local.color });
    } else if (prev === Ubi.myUserId && next !== Ubi.myUserId) {
      PenEvents.sendToHost("user:update", { penColor: null });
    }
  });
  var PenSvg = ({ color }) => /* @__PURE__ */ jsxs("svg", { width: "18", height: "32", viewBox: "0 0 18 32", style: { display: "block" }, children: [
    /* @__PURE__ */ jsx("polygon", { points: "9,32 5,24 13,24", fill: "#888" }),
    /* @__PURE__ */ jsx("rect", { x: "5", y: "4", width: "8", height: "20", rx: "2", fill: color, stroke: "rgba(0,0,0,0.2)", strokeWidth: "0.8" }),
    /* @__PURE__ */ jsx("rect", { x: "6", y: "6", width: "2.5", height: "14", rx: "1", fill: "rgba(255,255,255,0.3)" }),
    /* @__PURE__ */ jsx("rect", { x: "5", y: "1", width: "8", height: "5", rx: "1.5", fill: "rgba(0,0,0,0.2)" })
  ] });
  function renderPen() {
    const color = pen.local.color;
    Ubi.ui.render(
      () => /* @__PURE__ */ jsx(Gripable, { grip, style: { color, width: "36px", height: "48px" }, children: /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: grip.isMine ? "rotate(-30deg)" : "none",
            transformOrigin: "bottom right",
            transition: "transform 0.15s ease"
          },
          children: /* @__PURE__ */ jsx(PenSvg, { color })
        }
      ) }),
      "pen-button"
    );
  }
  pen.onChange("color", renderPen);
  pen.onChange("strokeWidth", renderPen);
  grip.onChange(renderPen);
  renderPen();
})();
