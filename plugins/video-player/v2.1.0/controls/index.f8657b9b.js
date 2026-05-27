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
  var PlayIcon = ({ size = 24 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M8 5v14l11-7z" }) });
  var PauseIcon = ({ size = 24 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M6 19h4V5H6v14zm8-14v14h4V5h-4z" }) });
  var SkipPrevIcon = ({ size = 24 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M6 6h2v12H6zm3.5 6l8.5 6V6z" }) });
  var SkipNextIcon = ({ size = 24 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" }) });
  var RepeatIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" }) });
  var RepeatOneIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" }) });
  var ShuffleIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" }) });
  var VolumeHighIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" }) });
  var VolumeMediumIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z" }) });
  var VolumeLowIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M7 9v6h4l5 5V4l-5 5H7z" }) });
  var VolumeMuteIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" }) });

  // plugins/video-player/src/controls.worker.tsx
  var DEFAULT_API_BASE = "/plugins/video-player/api";
  var state = Ubi.state.define({
    // ── 共有 + 永続 ──
    isPlaying: Ubi.state.sync(false),
    baselineTime: Ubi.state.sync(0),
    playEpoch: Ubi.state.sync(0),
    duration: Ubi.state.sync(0),
    loop: Ubi.state.sync("none"),
    shuffle: Ubi.state.sync(false),
    apiBase: Ubi.state.sync(DEFAULT_API_BASE),
    // ── 共有 + 永続 (per-user) ──
    myVolume: Ubi.state.sync(0.7, { perUser: true }),
    // ── ローカル ──
    currentTrack: null,
    currentIndex: 0,
    totalTracks: 0
  });
  var fmt = (sec) => {
    if (!Number.isFinite(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  function currentTime() {
    if (!state.local.isPlaying) return state.local.baselineTime;
    const advanced = state.local.baselineTime + (Date.now() - state.local.playEpoch) / 1e3;
    if (state.local.duration > 0) return Math.min(advanced, state.local.duration);
    return advanced;
  }
  function buildTrackUrl(track) {
    const base = state.local.apiBase.trim() || DEFAULT_API_BASE;
    const endpoint = track.mode === "live" ? "live" : "video";
    return `${base}/${endpoint}/${track.id}`;
  }
  var screenTarget = { scope: "siblings", targetType: "video-player:screen" };
  var playlistTarget = { scope: "siblings", targetType: "video-player:playlist" };
  var syncScheduled = false;
  function scheduleSyncVideo() {
    if (syncScheduled) return;
    syncScheduled = true;
    queueMicrotask(() => {
      syncScheduled = false;
      const isLive = state.local.currentTrack?.mode === "live";
      if (!isLive && state.local.duration > 0) {
        VPEvents.emit("vp:media:seek", { time: currentTime() }, screenTarget);
      }
      if (state.local.isPlaying) VPEvents.emit("vp:media:play", {}, screenTarget);
      else VPEvents.emit("vp:media:pause", {}, screenTarget);
    });
  }
  var onSeek = (time) => {
    state.batch(() => {
      state.local.baselineTime = time;
      if (state.local.isPlaying) state.local.playEpoch = Date.now();
    });
  };
  var onPlayToggle = () => {
    if (state.local.isPlaying) {
      state.batch(() => {
        state.local.baselineTime = currentTime();
        state.local.isPlaying = false;
      });
    } else {
      state.batch(() => {
        state.local.playEpoch = Date.now();
        state.local.isPlaying = true;
      });
    }
  };
  var onPrev = () => {
    VPEvents.emit("vp:track:prev", {}, playlistTarget);
  };
  var onNext = () => {
    VPEvents.emit("vp:track:next", { loop: state.local.loop, shuffle: state.local.shuffle }, playlistTarget);
  };
  var onShuffleToggle = () => {
    state.local.shuffle = !state.local.shuffle;
  };
  var onLoopCycle = () => {
    state.local.loop = state.local.loop === "none" ? "all" : state.local.loop === "all" ? "one" : "none";
  };
  var onVolumeChange = (v) => {
    state.local.myVolume = v;
  };
  state.onChange("isPlaying", () => {
    scheduleSyncVideo();
    render();
  });
  state.onChange("baselineTime", scheduleSyncVideo);
  state.onChange("playEpoch", scheduleSyncVideo);
  state.onChange("myVolume", (v) => {
    VPEvents.emit("vp:media:volume", { volume: v }, screenTarget);
    render();
  });
  state.onChange("loop", render);
  state.onChange("shuffle", render);
  state.onChange("duration", render);
  function render() {
    const track = state.local.currentTrack;
    const ct = currentTime();
    const progress = state.local.duration > 0 ? ct / state.local.duration * 100 : 0;
    const isLive = track?.mode === "live";
    const volume = state.local.myVolume;
    const VolumeIcon = volume === 0 ? VolumeMuteIcon : volume < 0.3 ? VolumeLowIcon : volume < 0.7 ? VolumeMediumIcon : VolumeHighIcon;
    const LoopIconComp = state.local.loop === "one" ? RepeatOneIcon : RepeatIcon;
    const isPlaying = state.local.isPlaying;
    const empty = state.local.totalTracks === 0;
    Ubi.ui.render(
      () => /* @__PURE__ */ jsxs(
        "div",
        {
          style: {
            position: "absolute",
            inset: "0",
            background: "#1a1a1a",
            borderRadius: "12px",
            padding: "8px 12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontFamily: "system-ui, -apple-system, sans-serif",
            userSelect: "none",
            pointerEvents: "auto"
          },
          children: [
            /* @__PURE__ */ jsx(
              "input",
              {
                type: "range",
                min: "0",
                max: String(state.local.duration > 0 ? state.local.duration : 100),
                step: "0.1",
                value: String(ct.toFixed(1)),
                disabled: state.local.duration <= 0 || isLive,
                style: {
                  width: "100%",
                  height: "4px",
                  marginBottom: "8px",
                  display: "block",
                  cursor: state.local.duration <= 0 || isLive ? "default" : "pointer",
                  accentColor: "#007aff",
                  appearance: "none",
                  background: `linear-gradient(to right, #007aff ${progress}%, rgba(255,255,255,0.2) ${progress}%)`,
                  borderRadius: "2px",
                  outline: "none"
                },
                onUbiInput: (val) => onSeek(Number.parseFloat(String(val)))
              }
            ),
            /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }, children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px", flex: "1", minWidth: "0" }, children: [
                track?.thumbnail && /* @__PURE__ */ jsx(
                  "img",
                  {
                    src: track.thumbnail,
                    alt: "",
                    style: {
                      width: "36px",
                      height: "36px",
                      borderRadius: "4px",
                      objectFit: "cover",
                      flexShrink: "0"
                    }
                  }
                ),
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", minWidth: "0" }, children: [
                  /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        fontSize: "12px",
                        fontWeight: "600",
                        color: "#fff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis"
                      },
                      children: track ? track.title || track.id : "---"
                    }
                  ),
                  /* @__PURE__ */ jsxs("div", { style: { fontSize: "10px", color: "rgba(255,255,255,0.6)" }, children: [
                    fmt(ct),
                    " /",
                    " ",
                    state.local.duration > 0 ? fmt(state.local.duration) : isLive ? "LIVE" : "--:--"
                  ] })
                ] })
              ] }),
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
                /* @__PURE__ */ jsx(CtrlBtn, { disabled: empty, onClick: onPrev, children: /* @__PURE__ */ jsx(SkipPrevIcon, { size: 18 }) }),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    disabled: empty,
                    style: {
                      background: "#007aff",
                      border: "none",
                      color: "#fff",
                      cursor: empty ? "not-allowed" : "pointer",
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(0,122,255,0.3)",
                      opacity: empty ? "0.5" : "1"
                    },
                    onUbiClick: onPlayToggle,
                    children: isPlaying ? /* @__PURE__ */ jsx(PauseIcon, { size: 20 }) : /* @__PURE__ */ jsx(PlayIcon, { size: 20 })
                  }
                ),
                /* @__PURE__ */ jsx(CtrlBtn, { disabled: empty, onClick: onNext, children: /* @__PURE__ */ jsx(SkipNextIcon, { size: 18 }) })
              ] }),
              /* @__PURE__ */ jsxs(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    flex: "1",
                    justifyContent: "flex-end"
                  },
                  children: [
                    /* @__PURE__ */ jsx(CtrlBtn, { active: state.local.shuffle, onClick: onShuffleToggle, children: /* @__PURE__ */ jsx(ShuffleIcon, { size: 16 }) }),
                    /* @__PURE__ */ jsx(CtrlBtn, { active: state.local.loop !== "none", onClick: onLoopCycle, children: /* @__PURE__ */ jsx(LoopIconComp, { size: 16 }) }),
                    /* @__PURE__ */ jsx("span", { style: { color: "rgba(255,255,255,0.8)", display: "flex", alignItems: "center" }, children: /* @__PURE__ */ jsx(VolumeIcon, { size: 16 }) }),
                    /* @__PURE__ */ jsx(
                      "input",
                      {
                        type: "range",
                        min: "0",
                        max: "1",
                        step: "0.01",
                        value: String(volume),
                        style: {
                          width: "60px",
                          height: "3px",
                          background: "rgba(255,255,255,0.2)",
                          borderRadius: "2px",
                          outline: "none",
                          cursor: "pointer",
                          appearance: "none",
                          accentColor: "#007aff"
                        },
                        onUbiInput: (val) => onVolumeChange(Number.parseFloat(String(val)))
                      }
                    )
                  ]
                }
              )
            ] })
          ]
        }
      ),
      "controls"
    );
  }
  function CtrlBtn({
    children,
    onClick,
    disabled = false,
    active = false
  }) {
    return /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        disabled,
        style: {
          background: "transparent",
          border: "none",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: "6px",
          borderRadius: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: "0",
          color: disabled ? "rgba(255,255,255,0.3)" : active ? "#007aff" : "rgba(255,255,255,0.8)",
          opacity: disabled ? "0.3" : "1"
        },
        onUbiClick: onClick,
        children
      }
    );
  }
  VPEvents.on("vp:track:current", ({ track, index, total }) => {
    const changed = state.local.currentTrack?.id !== track?.id;
    state.local.currentTrack = track;
    state.local.currentIndex = index;
    state.local.totalTracks = total;
    if (changed) {
      state.batch(() => {
        state.local.baselineTime = 0;
        state.local.playEpoch = Date.now();
        state.local.duration = 0;
      });
    }
    render();
    if (changed && track) {
      VPEvents.emit("vp:media:load", { url: buildTrackUrl(track), mode: track.mode }, screenTarget);
    }
  });
  VPEvents.on("vp:media:time", () => {
  });
  VPEvents.on("vp:media:loaded", ({ duration }) => {
    if (duration > 0) state.local.duration = duration;
    scheduleSyncVideo();
  });
  VPEvents.on("vp:media:ended", () => {
    VPEvents.emit("vp:track:next", { loop: state.local.loop, shuffle: state.local.shuffle }, playlistTarget);
  });
  VPEvents.on("vp:playback:stop", () => {
    state.batch(() => {
      state.local.baselineTime = currentTime();
      state.local.isPlaying = false;
    });
  });
  var accumulator = { ms: 0 };
  var ClockSystem = (_e, dt) => {
    if (!state.local.isPlaying) return;
    accumulator.ms += dt;
    if (accumulator.ms >= 100) {
      accumulator.ms = 0;
      render();
    }
  };
  Ubi.registerSystem(ClockSystem);
  render();
  queueMicrotask(() => VPEvents.emit("vp:media:volume", { volume: state.local.myVolume }, screenTarget));
})();
