"use strict";
(() => {
  // plugins/video-player/src/events.ts
  var VPEvents = Ubi.event.define();

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

  // plugins/video-player/src/icons.tsx
  var TrashIcon = ({ size = 14 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" }) });
  var PlaySmallIcon = () => /* @__PURE__ */ jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M8 5v14l11-7z" }) });

  // plugins/video-player/src/playlist.worker.tsx
  var state = Ubi.state.define({
    playlist: Ubi.state.sync([]),
    currentIndex: Ubi.state.sync(0)
  });
  var fmt = (sec) => {
    if (!Number.isFinite(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  function emitCurrent() {
    const list = state.local.playlist;
    const idx = state.local.currentIndex;
    const track = list[idx] ?? null;
    VPEvents.emit("vp:track:current", { track, index: idx, total: list.length }, { scope: "siblings" });
  }
  function addTrack(track) {
    state.local.playlist = [...state.local.playlist, track];
  }
  function selectTrack(i) {
    if (i < 0 || i >= state.local.playlist.length) return;
    state.local.currentIndex = i;
  }
  function removeTrack(i) {
    const newList = state.local.playlist.filter((_, idx) => idx !== i);
    state.batch(() => {
      let newIdx = state.local.currentIndex;
      if (i < newIdx) newIdx -= 1;
      if (newIdx >= newList.length) newIdx = Math.max(0, newList.length - 1);
      state.local.playlist = newList;
      state.local.currentIndex = newIdx;
    });
  }
  function nextTrack(loop, shuffle) {
    const len = state.local.playlist.length;
    if (len === 0) return;
    if (loop === "one") {
      emitCurrent();
      return;
    }
    if (shuffle) {
      state.local.currentIndex = Math.floor(Math.random() * len);
      return;
    }
    const cur = state.local.currentIndex;
    if (cur + 1 < len) {
      state.local.currentIndex = cur + 1;
      return;
    }
    if (loop === "all") {
      state.local.currentIndex = 0;
    } else {
      VPEvents.emit("vp:playback:stop", {}, { scope: "siblings", targetType: "video-player:controls" });
    }
  }
  function prevTrack() {
    const len = state.local.playlist.length;
    if (len === 0) return;
    state.local.currentIndex = state.local.currentIndex > 0 ? state.local.currentIndex - 1 : len - 1;
  }
  state.onChange("playlist", emitCurrent);
  state.onChange("currentIndex", emitCurrent);
  function render() {
    const list = state.local.playlist;
    const cur = state.local.currentIndex;
    Ubi.ui.render(
      () => /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            position: "absolute",
            inset: "0",
            background: "#1a1a1a",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            border: "1px solid rgba(255,255,255,0.08)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily: "system-ui, -apple-system, sans-serif",
            userSelect: "none",
            pointerEvents: "auto"
          },
          children: [
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  padding: "8px 12px",
                  borderBottom: "1px solid rgba(255,255,255,0.1)",
                  fontSize: "12px",
                  fontWeight: "600",
                  color: "#fff"
                },
                children: [
                  "Playlist (",
                  list.length,
                  ")"
                ]
              }
            ),
            /* @__PURE__ */ jsx("div", { style: { flex: "1", overflowY: "auto", padding: "8px" }, children: list.length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: "24px", textAlign: "center" }, children: /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "rgba(255,255,255,0.5)" }, children: "No tracks" }) }) : list.map((t, i) => /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  marginBottom: "4px",
                  background: i === cur ? "rgba(0,122,255,0.2)" : "transparent",
                  cursor: "pointer"
                },
                onUbiClick: () => selectTrack(i),
                children: [
                  /* @__PURE__ */ jsx(
                    "img",
                    {
                      src: t.thumbnail,
                      alt: "",
                      style: {
                        width: "32px",
                        height: "32px",
                        borderRadius: "4px",
                        objectFit: "cover"
                      }
                    }
                  ),
                  /* @__PURE__ */ jsxs("div", { style: { flex: "1", minWidth: "0" }, children: [
                    /* @__PURE__ */ jsxs(
                      "div",
                      {
                        style: {
                          fontSize: "11px",
                          fontWeight: "500",
                          color: "#fff",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        },
                        children: [
                          /* @__PURE__ */ jsx(
                            "span",
                            {
                              style: {
                                display: "inline-block",
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                background: t.mode === "live" ? "#ff4444" : "#4444ff",
                                marginRight: "5px",
                                verticalAlign: "middle"
                              }
                            }
                          ),
                          t.title
                        ]
                      }
                    ),
                    /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "rgba(255,255,255,0.6)" }, children: t.duration > 0 ? fmt(t.duration) : t.mode === "live" ? "LIVE" : "--:--" })
                  ] }),
                  i === cur && /* @__PURE__ */ jsx("span", { style: { color: "#007aff", flexShrink: "0" }, children: /* @__PURE__ */ jsx(PlaySmallIcon, {}) }),
                  /* @__PURE__ */ jsx(
                    "button",
                    {
                      type: "button",
                      style: {
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,255,255,0.6)",
                        cursor: "pointer",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        display: "flex",
                        alignItems: "center"
                      },
                      onUbiClick: () => removeTrack(i),
                      children: /* @__PURE__ */ jsx(TrashIcon, { size: 14 })
                    }
                  )
                ]
              },
              `${t.id}-${i}`
            )) })
          ]
        }
      ),
      "playlist"
    );
  }
  state.onChange("playlist", render);
  state.onChange("currentIndex", render);
  VPEvents.on("vp:track:add", ({ track }) => addTrack(track));
  VPEvents.on("vp:track:remove", ({ index }) => removeTrack(index));
  VPEvents.on("vp:track:next", ({ loop, shuffle }) => nextTrack(loop, shuffle));
  VPEvents.on("vp:track:prev", () => prevTrack());
  render();
  queueMicrotask(emitCurrent);
})();
