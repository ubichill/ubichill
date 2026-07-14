"use strict";
(() => {
  // plugins/video-player/src/events.ts
  var VPTarget = {
    screen: { scope: "siblings", targetType: "video-player:screen" },
    controls: { scope: "siblings", targetType: "video-player:controls" },
    playlist: { scope: "siblings", targetType: "video-player:playlist" },
    siblings: { scope: "siblings" }
  };
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
  var VideoIcon = ({ size = 16 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" }) });
  var SearchIcon = ({ size = 14 }) => /* @__PURE__ */ jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" }) });

  // plugins/video-player/src/lib/playback.ts
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // plugins/video-player/src/lib/youtube.ts
  var URL_PATTERNS = [
    /[?&]v=([\w-]{6,20})/,
    /youtu\.be\/([\w-]{6,20})/,
    /youtube\.com\/(?:live|embed|shorts)\/([\w-]{6,20})/
  ];
  var RAW_ID_RE = /^[\w-]{6,20}$/;
  function parseVideoId(input) {
    const s = (input ?? "").trim();
    if (!s) return null;
    for (const re of URL_PATTERNS) {
      const m = re.exec(s);
      if (m) return m[1];
    }
    return RAW_ID_RE.test(s) ? s : null;
  }
  function thumbnailUrl(idOrUrl) {
    const id = parseVideoId(idOrUrl);
    return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : "";
  }

  // plugins/video-player/src/search.worker.tsx
  var DEFAULT_API_BASE = "/plugins/video-player/api";
  var state = Ubi.state.define({
    apiBase: DEFAULT_API_BASE,
    selectedMode: "video",
    urlInput: "",
    searchQuery: "",
    searchResults: [],
    isSearching: false
  });
  var emitAddTrack = (track) => {
    VPEvents.emit("vp:track:add", { track }, VPTarget.playlist);
  };
  var apiBase = () => state.local.apiBase.trim() || DEFAULT_API_BASE;
  var setMode = (m) => {
    state.local.selectedMode = m;
    render();
  };
  var setUrl = (v) => {
    state.local.urlInput = v;
  };
  var setQuery = (v) => {
    state.local.searchQuery = v;
  };
  var addFromUrl = async () => {
    const videoId = parseVideoId(state.local.urlInput);
    if (!videoId) return;
    state.local.isSearching = true;
    render();
    const res = await Ubi.fetch(`${apiBase()}/info/${videoId}`);
    const info = res.ok ? JSON.parse(res.body) : {};
    emitAddTrack({
      id: videoId,
      title: info.title ?? state.local.urlInput,
      thumbnail: info.thumbnail ?? thumbnailUrl(videoId),
      duration: info.duration ?? 0,
      mode: state.local.selectedMode
    });
    state.local.urlInput = "";
    state.local.isSearching = false;
    render();
  };
  var doSearch = async () => {
    if (!state.local.searchQuery.trim()) return;
    state.local.isSearching = true;
    render();
    const res = await Ubi.fetch(
      `${apiBase()}/search?q=${encodeURIComponent(state.local.searchQuery)}&limit=10`
    );
    state.local.searchResults = res.ok ? JSON.parse(res.body) : [];
    state.local.isSearching = false;
    render();
  };
  var addResult = (r) => {
    emitAddTrack({
      id: r.id,
      title: r.title,
      thumbnail: r.thumbnail,
      duration: r.duration,
      mode: state.local.selectedMode
    });
  };
  function render() {
    const { selectedMode, urlInput, searchQuery, searchResults, isSearching } = state.local;
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
            /* @__PURE__ */ jsxs("div", { style: { padding: "8px", display: "flex", flexDirection: "column", gap: "6px" }, children: [
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "0" }, children: [
                /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    style: {
                      flex: "1",
                      background: selectedMode === "live" ? "#ff4444" : "#333",
                      border: "none",
                      borderRadius: "4px 0 0 4px",
                      color: "#fff",
                      padding: "6px 12px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px"
                    },
                    onUbiClick: () => setMode("live"),
                    children: [
                      /* @__PURE__ */ jsx(
                        "span",
                        {
                          style: {
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            background: "#fff",
                            display: "inline-block"
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
                      flex: "1",
                      background: selectedMode === "video" ? "#4444ff" : "#333",
                      border: "none",
                      borderRadius: "0 4px 4px 0",
                      color: "#fff",
                      padding: "6px 12px",
                      fontSize: "12px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px"
                    },
                    onUbiClick: () => setMode("video"),
                    children: [
                      /* @__PURE__ */ jsx(VideoIcon, { size: 12 }),
                      "Video"
                    ]
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "4px" }, children: [
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    type: "text",
                    placeholder: "YouTube URL or ID...",
                    value: urlInput,
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
                    onUbiInput: (val) => setUrl(String(val))
                  }
                ),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    disabled: isSearching,
                    style: {
                      background: "rgba(255,255,255,0.1)",
                      border: "none",
                      color: "rgba(255,255,255,0.8)",
                      cursor: isSearching ? "not-allowed" : "pointer",
                      padding: "5px 10px",
                      borderRadius: "6px",
                      fontSize: "14px",
                      opacity: isSearching ? "0.5" : "1"
                    },
                    onUbiClick: () => {
                      void addFromUrl();
                    },
                    children: "+"
                  }
                )
              ] }),
              /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: "4px" }, children: [
                /* @__PURE__ */ jsx(
                  "input",
                  {
                    type: "text",
                    placeholder: "Search YouTube...",
                    value: searchQuery,
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
                    onUbiInput: (val) => setQuery(String(val))
                  }
                ),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    disabled: isSearching,
                    style: {
                      background: "rgba(255,255,255,0.1)",
                      border: "none",
                      color: "rgba(255,255,255,0.8)",
                      cursor: isSearching ? "not-allowed" : "pointer",
                      padding: "5px 10px",
                      borderRadius: "6px",
                      display: "flex",
                      alignItems: "center",
                      opacity: isSearching ? "0.5" : "1"
                    },
                    onUbiClick: () => {
                      void doSearch();
                    },
                    children: /* @__PURE__ */ jsx(SearchIcon, { size: 14 })
                  }
                )
              ] })
            ] }),
            /* @__PURE__ */ jsx("div", { style: { flex: "1", overflowY: "auto", padding: "8px" }, children: searchResults.length === 0 ? /* @__PURE__ */ jsx(
              "div",
              {
                style: {
                  padding: "24px",
                  textAlign: "center",
                  fontSize: "12px",
                  color: "rgba(255,255,255,0.5)"
                },
                children: isSearching ? "Searching..." : "No results"
              }
            ) : searchResults.map((r) => /* @__PURE__ */ jsxs(
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
                      src: r.thumbnail,
                      alt: "",
                      loading: "lazy",
                      decoding: "async",
                      width: "32",
                      height: "32",
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
                        children: r.title
                      }
                    ),
                    /* @__PURE__ */ jsx("div", { style: { fontSize: "10px", color: "rgba(255,255,255,0.6)" }, children: formatTime(r.duration) })
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
                      onUbiClick: () => addResult(r),
                      children: "+"
                    }
                  )
                ]
              },
              r.id
            )) })
          ]
        }
      ),
      "search"
    );
  }
  render();
})();
