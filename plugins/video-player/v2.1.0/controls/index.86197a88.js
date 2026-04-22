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
  var VideoIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" }) });
  var ListIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z" }) });
  var ExpandIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M15 3l2.3 2.3-2.89 2.87 1.42 1.42L18.7 6.7 21 9V3h-6zM3 9l2.3-2.3 2.87 2.89 1.42-1.42L6.7 5.3 9 3H3v6zm6 12l-2.3-2.3 2.89-2.87-1.42-1.42L5.3 17.3 3 15v6h6zm12-6l-2.3 2.3-2.87-2.89-1.42 1.42 2.89 2.87L15 21h6v-6z" }) });
  var TrashIcon = ({ size = 14 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" }) });
  var PlaySmallIcon = () => /* @__PURE__ */ jsx("svg", { width: "12", height: "12", viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M8 5v14l11-7z" }) });
  var SearchIcon = ({ size = 14 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" }) });

  // plugins/video-player/src/ui/controls.ui.tsx
  var _fmt = (sec) => {
    if (!Number.isFinite(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };
  var _btnBase = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    padding: "6px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: "0"
  };
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
          ..._btnBase,
          color: disabled ? "rgba(255,255,255,0.3)" : active ? "#007aff" : "rgba(255,255,255,0.8)",
          opacity: disabled ? "0.3" : "1",
          cursor: disabled ? "not-allowed" : "pointer"
        },
        onUbiClick: onClick,
        children
      }
    );
  }
  function renderControlsUI(state2, actions2) {
    const track = state2.playlist[state2.currentIndex];
    const ct = state2.currentTime;
    const progress = state2.duration > 0 ? ct / state2.duration * 100 : 0;
    const isLive = track?.mode === "live";
    const VolumeIcon = state2.volume === 0 ? VolumeMuteIcon : state2.volume < 0.3 ? VolumeLowIcon : state2.volume < 0.7 ? VolumeMediumIcon : VolumeHighIcon;
    const LoopIconComp = state2.loop === "track" ? RepeatOneIcon : RepeatIcon;
    return /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "relative",
          width: "100%",
          pointerEvents: "auto",
          fontFamily: "system-ui, -apple-system, sans-serif",
          userSelect: "none"
        },
        children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", flexDirection: "column", gap: "8px" }, children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                background: "rgba(20,20,20,0.95)",
                backdropFilter: "blur(10px)",
                borderRadius: "12px",
                padding: "8px 12px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.1)"
              },
              children: [
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    type: "range",
                    min: "0",
                    max: String(state2.duration > 0 ? Math.floor(state2.duration) : 100),
                    step: "1",
                    value: String(Math.round(ct)),
                    disabled: state2.duration <= 0 || isLive,
                    style: {
                      width: "100%",
                      height: "4px",
                      marginBottom: "8px",
                      display: "block",
                      cursor: state2.duration <= 0 || isLive ? "default" : "pointer",
                      accentColor: "#007aff",
                      appearance: "none",
                      background: `linear-gradient(to right, #007aff ${progress}%, rgba(255,255,255,0.2) ${progress}%)`,
                      borderRadius: "2px",
                      outline: "none"
                    },
                    onUbiInput: (val) => actions2.onSeek(Number.parseFloat(String(val)))
                  }
                ),
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px"
                    },
                    children: [
                      /* @__PURE__ */ jsxs(
                        "div",
                        {
                          style: {
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flex: "1",
                            minWidth: "0"
                          },
                          children: [
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
                                _fmt(ct),
                                " / ",
                                state2.duration > 0 ? _fmt(state2.duration) : isLive ? "LIVE" : "--:--"
                              ] })
                            ] })
                          ]
                        }
                      ),
                      /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
                        /* @__PURE__ */ jsx(CtrlBtn, { disabled: state2.playlist.length === 0, onClick: actions2.onPrev, children: /* @__PURE__ */ jsx(SkipPrevIcon, { size: 18 }) }),
                        /* @__PURE__ */ jsx(
                          "button",
                          {
                            type: "button",
                            disabled: state2.playlist.length === 0,
                            style: {
                              background: "#007aff",
                              border: "none",
                              color: "#fff",
                              cursor: state2.playlist.length === 0 ? "not-allowed" : "pointer",
                              width: "36px",
                              height: "36px",
                              borderRadius: "50%",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              boxShadow: "0 2px 8px rgba(0,122,255,0.3)",
                              flexShrink: "0",
                              opacity: state2.playlist.length === 0 ? "0.5" : "1"
                            },
                            onUbiClick: actions2.onPlayToggle,
                            children: state2.isPlaying ? /* @__PURE__ */ jsx(PauseIcon, { size: 20 }) : /* @__PURE__ */ jsx(PlayIcon, { size: 20 })
                          }
                        ),
                        /* @__PURE__ */ jsx(CtrlBtn, { disabled: state2.playlist.length === 0, onClick: actions2.onNext, children: /* @__PURE__ */ jsx(SkipNextIcon, { size: 18 }) })
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
                            /* @__PURE__ */ jsx(CtrlBtn, { active: state2.shuffle, onClick: actions2.onShuffleToggle, children: /* @__PURE__ */ jsx(ShuffleIcon, { size: 16 }) }),
                            /* @__PURE__ */ jsx(CtrlBtn, { active: state2.loop !== "none", onClick: actions2.onLoopCycle, children: /* @__PURE__ */ jsx(LoopIconComp, { size: 16 }) }),
                            /* @__PURE__ */ jsx(CtrlBtn, { onClick: () => {
                            }, children: /* @__PURE__ */ jsx(VolumeIcon, { size: 16 }) }),
                            /* @__PURE__ */ jsx(
                              "input",
                              {
                                type: "range",
                                min: "0",
                                max: "1",
                                step: "0.01",
                                value: String(state2.volume),
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
                                onUbiInput: (val) => actions2.onVolumeChange(Number.parseFloat(String(val)))
                              }
                            ),
                            /* @__PURE__ */ jsx(CtrlBtn, { active: state2.isVisible, onClick: actions2.onVisibilityToggle, children: /* @__PURE__ */ jsx(VideoIcon, { size: 16 }) }),
                            /* @__PURE__ */ jsx(CtrlBtn, { onClick: actions2.onResize, children: /* @__PURE__ */ jsx(ExpandIcon, { size: 16 }) }),
                            /* @__PURE__ */ jsx(CtrlBtn, { active: state2.showPlaylist, onClick: actions2.onShowPlaylistToggle, children: /* @__PURE__ */ jsx(ListIcon, { size: 16 }) })
                          ]
                        }
                      )
                    ]
                  }
                )
              ]
            }
          ),
          state2.showPlaylist && /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                maxHeight: "300px",
                background: "rgba(20,20,20,0.95)",
                backdropFilter: "blur(10px)",
                borderRadius: "12px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                border: "1px solid rgba(255,255,255,0.1)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column"
              },
              children: [
                /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 12px",
                      borderBottom: "1px solid rgba(255,255,255,0.1)"
                    },
                    children: [
                      /* @__PURE__ */ jsxs("span", { style: { fontSize: "12px", fontWeight: "600", color: "#fff", flexShrink: "0" }, children: [
                        "Playlist (",
                        state2.playlist.length,
                        ")"
                      ] }),
                      /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "0", flexShrink: "0" }, children: [
                        /* @__PURE__ */ jsxs(
                          "button",
                          {
                            type: "button",
                            style: {
                              background: state2.selectedMode === "live" ? "#ff4444" : "#333",
                              border: "none",
                              borderRadius: "4px 0 0 4px",
                              color: "#fff",
                              padding: "6px 12px",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px"
                            },
                            onUbiClick: () => actions2.onSelectMode("live"),
                            children: [
                              /* @__PURE__ */ jsx(
                                "span",
                                {
                                  style: {
                                    width: "7px",
                                    height: "7px",
                                    borderRadius: "50%",
                                    background: "#fff",
                                    display: "inline-block",
                                    flexShrink: "0"
                                  }
                                }
                              ),
                              "Live"
                            ]
                          }
                        ),
                        /* @__PURE__ */ jsxs(
                          "button",
                          {
                            type: "button",
                            style: {
                              background: state2.selectedMode === "video" ? "#4444ff" : "#333",
                              border: "none",
                              borderRadius: "0 4px 4px 0",
                              color: "#fff",
                              padding: "6px 12px",
                              fontSize: "12px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px"
                            },
                            onUbiClick: () => actions2.onSelectMode("video"),
                            children: [
                              /* @__PURE__ */ jsx(VideoIcon, { size: 12 }),
                              "Video"
                            ]
                          }
                        )
                      ] }),
                      /* @__PURE__ */ jsx(
                        "input",
                        {
                          type: "text",
                          placeholder: "YouTube URL or ID...",
                          value: state2.urlInput,
                          style: {
                            flex: "1",
                            background: "rgba(255,255,255,0.1)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "6px",
                            padding: "5px 8px",
                            color: "#fff",
                            fontSize: "12px",
                            outline: "none",
                            minWidth: "0"
                          },
                          onUbiInput: (val) => actions2.onUrlInputChange(String(val))
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          disabled: state2.isSearching,
                          style: {
                            background: "rgba(255,255,255,0.1)",
                            border: "none",
                            color: "rgba(255,255,255,0.8)",
                            cursor: state2.isSearching ? "not-allowed" : "pointer",
                            padding: "5px 10px",
                            borderRadius: "6px",
                            fontSize: "14px",
                            opacity: state2.isSearching ? "0.5" : "1",
                            flexShrink: "0"
                          },
                          onUbiClick: actions2.onAddFromUrl,
                          children: state2.isSearching ? "..." : "+"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "input",
                        {
                          type: "text",
                          placeholder: "Search YouTube...",
                          value: state2.searchQuery,
                          style: {
                            flex: "1",
                            background: "rgba(255,255,255,0.1)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "6px",
                            padding: "5px 8px",
                            color: "#fff",
                            fontSize: "12px",
                            outline: "none",
                            minWidth: "0"
                          },
                          onUbiInput: (val) => actions2.onSearchQueryChange(String(val))
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          disabled: state2.isSearching,
                          style: {
                            background: "rgba(255,255,255,0.1)",
                            border: "none",
                            color: "rgba(255,255,255,0.8)",
                            cursor: state2.isSearching ? "not-allowed" : "pointer",
                            padding: "5px 10px",
                            borderRadius: "6px",
                            display: "flex",
                            alignItems: "center",
                            opacity: state2.isSearching ? "0.5" : "1",
                            flexShrink: "0"
                          },
                          onUbiClick: actions2.onDoSearch,
                          children: state2.isSearching ? "..." : /* @__PURE__ */ jsx(SearchIcon, { size: 14 })
                        }
                      )
                    ]
                  }
                ),
                state2.searchResults.length > 0 && /* @__PURE__ */ jsx("div", { style: { overflowY: "auto", padding: "8px" }, children: state2.searchResults.map((result) => /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      marginBottom: "4px"
                    },
                    children: [
                      /* @__PURE__ */ jsx(
                        "img",
                        {
                          src: result.thumbnail,
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
                        /* @__PURE__ */ jsx(
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
                            children: result.title
                          }
                        ),
                        /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "rgba(255,255,255,0.6)" }, children: _fmt(result.duration) })
                      ] }),
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
                            fontSize: "16px"
                          },
                          onUbiClick: () => actions2.onAddSearchResult(result),
                          children: "+"
                        }
                      )
                    ]
                  },
                  result.id
                )) }),
                /* @__PURE__ */ jsx("div", { style: { flex: "1", overflowY: "auto", padding: "8px" }, children: state2.playlist.length === 0 ? /* @__PURE__ */ jsx("div", { style: { padding: "24px", textAlign: "center" }, children: /* @__PURE__ */ jsx("div", { style: { fontSize: "12px", color: "rgba(255,255,255,0.5)" }, children: "No tracks in playlist" }) }) : state2.playlist.map((t, i) => /* @__PURE__ */ jsxs(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      marginBottom: "4px",
                      background: i === state2.currentIndex ? "rgba(0,122,255,0.2)" : "transparent",
                      cursor: "pointer"
                    },
                    onUbiClick: () => actions2.onSelectTrack(i),
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
                                    flexShrink: "0",
                                    verticalAlign: "middle"
                                  }
                                }
                              ),
                              t.title
                            ]
                          }
                        ),
                        /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "rgba(255,255,255,0.6)" }, children: t.duration > 0 ? _fmt(t.duration) : t.mode === "live" ? "LIVE" : "--:--" })
                      ] }),
                      i === state2.currentIndex && /* @__PURE__ */ jsx("span", { style: { color: "#007aff", flexShrink: "0" }, children: /* @__PURE__ */ jsx(PlaySmallIcon, {}) }),
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
                          onUbiClick: () => actions2.onRemoveTrack(i),
                          children: /* @__PURE__ */ jsx(TrashIcon, { size: 14 })
                        }
                      )
                    ]
                  },
                  t.id
                )) })
              ]
            }
          )
        ] })
      }
    );
  }

  // plugins/video-player/src/system/controls.ts
  var state = Ubi.state.define({
    // entity.data と自動同期される共有状態
    playlist: Ubi.state.persistent([]),
    currentIndex: Ubi.state.persistent(0),
    isPlaying: Ubi.state.persistent(false),
    isVisible: Ubi.state.persistent(false),
    loop: Ubi.state.persistent("none"),
    shuffle: Ubi.state.persistent(false),
    currentTime: Ubi.state.persistent(0),
    duration: Ubi.state.persistent(0),
    apiBase: Ubi.state.persistent(""),
    seekNonce: Ubi.state.persistent(0),
    // per-user 音量
    myVolume: Ubi.state.persistMine(0.7),
    // 進行バー推定用 (ローカル)
    lastSyncedTime: 0,
    lastSyncedAt: 0,
    // サイズ (transform は state では管理しない)
    screenW: 640,
    screenH: 360,
    screenEntityId: null,
    screenTransform: null,
    // UI ローカル
    showPlaylist: true,
    selectedMode: "video",
    urlInput: "",
    searchQuery: "",
    searchResults: [],
    isSearching: false
  });
  var SIZE_PRESETS = [
    [640, 360],
    [960, 540],
    [1280, 720]
  ];
  var DEFAULT_API_BASE = "/plugins/video-player/api";
  var _extractYouTubeId = (url) => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
      /youtube\.com\/embed\/([\w-]+)/,
      /^([\w-]{11})$/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  };
  function _estimatedTime() {
    if (!state.local.isPlaying || state.local.duration <= 0) return state.local.lastSyncedTime;
    const elapsed = (Date.now() - state.local.lastSyncedAt) / 1e3;
    return Math.min(state.local.lastSyncedTime + elapsed, state.local.duration);
  }
  function _apiBase() {
    return state.local.apiBase.trim() || DEFAULT_API_BASE;
  }
  state.onChange("currentTime", (next) => {
    state.local.lastSyncedTime = next;
    state.local.lastSyncedAt = Date.now();
  });
  state.onChange("isPlaying", (playing) => {
    if (playing) {
      state.local.lastSyncedAt = Date.now();
    } else {
      state.local.lastSyncedTime = _estimatedTime();
    }
    _render();
  });
  state.onChange("currentIndex", () => {
    state.local.lastSyncedTime = 0;
    state.local.lastSyncedAt = Date.now();
    state.local.duration = 0;
    _render();
  });
  state.onChange("seekNonce", () => {
    state.local.lastSyncedTime = state.local.currentTime;
    state.local.lastSyncedAt = Date.now();
    _render();
  });
  state.onChange("playlist", (v) => {
    Ubi.log(`[Controls:onChange] playlist changed: ${v.length} tracks`, "info");
    _render();
  });
  state.onChange("isVisible", _render);
  state.onChange("loop", _render);
  state.onChange("shuffle", _render);
  state.onChange("duration", _render);
  state.onChange("myVolume", _render);
  var actions = {
    onSeek: (time) => {
      state.local.currentTime = time;
      state.local.seekNonce = Date.now();
    },
    onPlayToggle: () => {
      const next = !state.local.isPlaying;
      state.local.currentTime = next ? state.local.lastSyncedTime : _estimatedTime();
      state.local.isPlaying = next;
    },
    onPrev: () => {
      if (state.local.playlist.length === 0) return;
      const prev = state.local.currentIndex > 0 ? state.local.currentIndex - 1 : state.local.playlist.length - 1;
      state.local.currentTime = 0;
      state.local.currentIndex = prev;
      state.local.isPlaying = true;
    },
    onNext: () => {
      if (state.local.playlist.length === 0) return;
      const next = state.local.currentIndex < state.local.playlist.length - 1 ? state.local.currentIndex + 1 : 0;
      state.local.currentTime = 0;
      state.local.currentIndex = next;
      state.local.isPlaying = true;
    },
    onShuffleToggle: () => {
      state.local.shuffle = !state.local.shuffle;
    },
    onLoopCycle: () => {
      state.local.loop = state.local.loop === "none" ? "playlist" : state.local.loop === "playlist" ? "track" : "none";
    },
    onVolumeChange: (v) => {
      state.local.myVolume = v;
    },
    onVisibilityToggle: () => {
      state.local.isVisible = !state.local.isVisible;
    },
    onResize: () => {
      if (!state.local.screenEntityId || !state.local.screenTransform) return;
      const current = SIZE_PRESETS.findIndex(([w]) => w === state.local.screenW);
      const [nw, nh] = SIZE_PRESETS[(current + 1) % SIZE_PRESETS.length];
      state.local.screenW = nw;
      state.local.screenH = nh;
      const nextTransform = { ...state.local.screenTransform, w: nw, h: nh };
      void Ubi.world.updateEntity(state.local.screenEntityId, { transform: nextTransform });
      state.local.screenTransform = nextTransform;
      _render();
    },
    onShowPlaylistToggle: () => {
      state.local.showPlaylist = !state.local.showPlaylist;
      _render();
    },
    onSelectMode: (mode) => {
      state.local.selectedMode = mode;
      _render();
    },
    onUrlInputChange: (v) => {
      state.local.urlInput = v;
    },
    onAddFromUrl: () => {
      void _addFromUrl();
    },
    onSearchQueryChange: (v) => {
      state.local.searchQuery = v;
    },
    onDoSearch: () => {
      void _doSearch();
    },
    onAddSearchResult: (result) => {
      state.local.playlist = [
        ...state.local.playlist,
        {
          id: result.id,
          title: result.title,
          thumbnail: result.thumbnail,
          duration: result.duration,
          mode: state.local.selectedMode
        }
      ];
      state.local.searchResults = [];
      state.local.searchQuery = "";
    },
    onSelectTrack: (i) => {
      state.local.currentTime = 0;
      state.local.currentIndex = i;
      state.local.isPlaying = true;
    },
    onRemoveTrack: (i) => {
      const newList = state.local.playlist.filter((_, idx) => idx !== i);
      const newIdx = state.local.currentIndex >= newList.length ? Math.max(0, newList.length - 1) : state.local.currentIndex;
      state.local.playlist = newList;
      state.local.currentIndex = newIdx;
    }
  };
  async function _addFromUrl() {
    const videoId = _extractYouTubeId(state.local.urlInput.trim());
    if (!videoId) return;
    state.local.isSearching = true;
    _render();
    try {
      const res = await Ubi.network.fetch(`${_apiBase()}/info/${videoId}`);
      const info = res.ok ? JSON.parse(res.body) : {};
      state.local.playlist = [
        ...state.local.playlist,
        {
          id: videoId,
          title: info.title ?? state.local.urlInput,
          thumbnail: info.thumbnail ?? `https://i.ytimg.com/vi/${videoId}/default.jpg`,
          duration: info.duration ?? 0,
          mode: state.local.selectedMode
        }
      ];
      state.local.urlInput = "";
    } catch (err) {
      Ubi.log(`[Controls] addFromUrl error: ${String(err)}`, "warn");
    }
    state.local.isSearching = false;
    _render();
  }
  async function _doSearch() {
    if (!state.local.searchQuery.trim()) return;
    state.local.isSearching = true;
    _render();
    try {
      const res = await Ubi.network.fetch(
        `${_apiBase()}/search?q=${encodeURIComponent(state.local.searchQuery)}&limit=10`
      );
      if (res.ok) state.local.searchResults = JSON.parse(res.body);
    } catch (err) {
      Ubi.log(`[Controls] search error: ${String(err)}`, "warn");
    }
    state.local.isSearching = false;
    _render();
  }
  function _toUIState() {
    return {
      playlist: state.local.playlist,
      currentIndex: state.local.currentIndex,
      isPlaying: state.local.isPlaying,
      isVisible: state.local.isVisible,
      volume: state.local.myVolume,
      loop: state.local.loop,
      shuffle: state.local.shuffle,
      duration: state.local.duration,
      currentTime: _estimatedTime(),
      showPlaylist: state.local.showPlaylist,
      selectedMode: state.local.selectedMode,
      urlInput: state.local.urlInput,
      searchQuery: state.local.searchQuery,
      searchResults: state.local.searchResults,
      isSearching: state.local.isSearching
    };
  }
  function _render() {
    Ubi.ui.render(() => renderControlsUI(_toUIState(), actions), "player");
  }
  var ControlsSystem = (_entities, _dt, events) => {
    for (const event of events) {
      if (event.type === "entity:video-player:screen") {
        const entity = event.payload;
        if (entity.id) state.local.screenEntityId = entity.id;
        if (entity.transform) {
          state.local.screenW = entity.transform.w;
          state.local.screenH = entity.transform.h;
          state.local.screenTransform = entity.transform;
        }
      }
    }
  };
  function initControls() {
    state.local.apiBase = _apiBase();
    Ubi.log(
      `[Controls:init] playlist=${state.local.playlist.length} isPlaying=${state.local.isPlaying} currentTime=${state.local.currentTime}`,
      "info"
    );
    if (state.local.currentTime > 0) {
      state.local.lastSyncedTime = state.local.currentTime;
      state.local.lastSyncedAt = Date.now();
    }
    _render();
    setInterval(_render, 500);
  }

  // plugins/video-player/src/controls.worker.tsx
  Ubi.registerSystem(ControlsSystem);
  initControls();
})();
