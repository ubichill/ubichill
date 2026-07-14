"use strict";
(() => {
  // plugins/avatar/src/events.ts
  var AvatarEvents = Ubi.event.define();

  // plugins/avatar/src/cssToState.ts
  function cssToState(css) {
    if (css === "pointer") return "pointer";
    if (css === "text" || css === "vertical-text") return "text";
    if (css === "wait" || css === "progress") return "wait";
    if (css === "help") return "help";
    if (css === "not-allowed" || css === "no-drop") return "not-allowed";
    if (css === "move") return "move";
    if (css === "grabbing") return "grabbing";
    return "default";
  }

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

  // plugins/avatar/src/ui/SettingsPanel.tsx
  function renderSettingsPanel(state, actions2) {
    const cursorState = cssToState(state.cursorStyle);
    const currentStateDef = state.avatar.states[cursorState] ?? state.avatar.states.default;
    return /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          width: "280px",
          pointerEvents: "auto",
          background: "white",
          borderRadius: "16px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          padding: "16px",
          fontFamily: "sans-serif",
          fontSize: "13px",
          color: "#212529"
        },
        children: [
          /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                fontWeight: "bold",
                marginBottom: "12px",
                fontSize: "14px",
                color: "#1c7ed6",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              },
              children: [
                /* @__PURE__ */ jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "currentColor", children: /* @__PURE__ */ jsx("path", { d: "M4 0 20 12l-7 1-4 8z" }) }),
                "\u30AB\u30FC\u30BD\u30EB\u30C6\u30FC\u30DE"
              ]
            }
          ),
          state.templates.length === 0 ? /* @__PURE__ */ jsx("div", { style: { color: "#868e96", fontSize: "12px", textAlign: "center", padding: "16px 0" }, children: "\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D..." }) : /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "8px",
                marginBottom: "12px"
              },
              children: state.templates.map((t) => {
                const isSelected = state.currentTemplateId === t.id;
                const isLoading = state.pendingTemplateId === t.id;
                const hostThumb = state.thumbnailUrls[t.id] ?? "";
                const thumbUrl = isSelected && !isLoading ? state.avatar.states?.default?.url ?? hostThumb : hostThumb;
                return /* @__PURE__ */ jsxs(
                  "button",
                  {
                    type: "button",
                    style: {
                      padding: "10px 6px",
                      border: `2px solid ${isSelected ? "#1c7ed6" : "#dee2e6"}`,
                      borderRadius: "12px",
                      background: isSelected ? "#e7f5ff" : "#f8f9fa",
                      cursor: isLoading ? "wait" : "pointer",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                      boxShadow: isSelected ? "0 2px 8px rgba(28,126,214,0.2)" : "none",
                      transition: "all 0.15s",
                      opacity: isLoading ? 0.6 : 1
                    },
                    onUbiClick: () => actions2.onApplyTemplate(t.id),
                    children: [
                      /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            width: "48px",
                            height: "48px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: thumbUrl ? "transparent" : "#e9ecef",
                            borderRadius: "8px",
                            overflow: "hidden"
                          },
                          children: isLoading ? /* @__PURE__ */ jsxs(
                            "svg",
                            {
                              width: "18",
                              height: "18",
                              viewBox: "0 0 24 24",
                              fill: "none",
                              stroke: "#1c7ed6",
                              strokeWidth: "2",
                              strokeLinecap: "round",
                              children: [
                                /* @__PURE__ */ jsx("circle", { cx: "12", cy: "12", r: "10", opacity: "0.25" }),
                                /* @__PURE__ */ jsx("path", { d: "M12 2a10 10 0 0 1 10 10" })
                              ]
                            }
                          ) : thumbUrl ? /* @__PURE__ */ jsx(
                            "img",
                            {
                              src: thumbUrl,
                              alt: t.name,
                              style: { width: "40px", height: "40px", objectFit: "contain" }
                            }
                          ) : /* @__PURE__ */ jsx("svg", { width: "22", height: "22", viewBox: "0 0 24 24", fill: "#adb5bd", children: /* @__PURE__ */ jsx("path", { d: "M4 0 20 12l-7 1-4 8z" }) })
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "div",
                        {
                          style: {
                            fontSize: "11px",
                            fontWeight: isSelected ? "bold" : "normal",
                            color: isSelected ? "#1c7ed6" : "#495057",
                            textAlign: "center"
                          },
                          children: t.name
                        }
                      )
                    ]
                  },
                  t.id
                );
              })
            }
          ),
          state.currentTemplateId !== null && /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              style: {
                width: "100%",
                padding: "6px 0",
                marginBottom: "8px",
                border: "1px solid #dee2e6",
                borderRadius: "8px",
                background: "#f8f9fa",
                fontSize: "12px",
                color: "#868e96",
                cursor: "pointer"
              },
              onUbiClick: actions2.onResetToDefault,
              children: "\u30C7\u30D5\u30A9\u30EB\u30C8\u306B\u623B\u3059"
            }
          ),
          /* @__PURE__ */ jsxs("details", { style: { marginTop: "4px" }, children: [
            /* @__PURE__ */ jsx(
              "summary",
              {
                style: {
                  fontSize: "11px",
                  color: "#868e96",
                  cursor: "pointer",
                  userSelect: "none"
                },
                children: "\u8A73\u7D30\u8A2D\u5B9A"
              }
            ),
            /* @__PURE__ */ jsxs("div", { style: { marginTop: "8px" }, children: [
              /* @__PURE__ */ jsxs("div", { style: { fontSize: "11px", color: "#868e96", marginBottom: "4px" }, children: [
                "\u72B6\u614B: ",
                cursorState
              ] }),
              currentStateDef?.url && /* @__PURE__ */ jsx(
                "img",
                {
                  src: currentStateDef.url,
                  alt: "preview",
                  style: {
                    maxWidth: "40px",
                    maxHeight: "40px",
                    border: "1px solid #dee2e6",
                    borderRadius: "4px",
                    marginBottom: "8px",
                    display: "block"
                  }
                }
              ),
              /* @__PURE__ */ jsx(
                "label",
                {
                  htmlFor: "avatar-cursor-image-url",
                  style: { fontSize: "11px", color: "#868e96", display: "block", marginBottom: "4px" },
                  children: "\u30AB\u30FC\u30BD\u30EB\u753B\u50CF URL"
                }
              ),
              /* @__PURE__ */ jsx(
                "input",
                {
                  id: "avatar-cursor-image-url",
                  type: "text",
                  value: currentStateDef?.url ?? "",
                  placeholder: "https://...",
                  style: {
                    width: "100%",
                    padding: "6px",
                    border: "1px solid #dee2e6",
                    borderRadius: "6px",
                    fontSize: "12px",
                    boxSizing: "border-box"
                  },
                  onUbiInput: (value) => actions2.onCursorImageUrlChange(cursorState, String(value))
                }
              )
            ] })
          ] })
        ]
      }
    );
  }

  // plugins/avatar/src/settings.worker.tsx
  var DEFAULT_Z = 9998;
  var settings = Ubi.state.define({
    templates: [],
    currentTemplateId: null,
    pendingTemplateId: null,
    templatesLoaded: false,
    thumbnailUrls: {},
    cursorStyle: "default",
    avatar: { states: {} },
    zIndex: DEFAULT_Z
  });
  void (async () => {
    const [self] = await Ubi.entity.query("avatar:settings");
    if (self) settings.local.zIndex = self.transform.z;
  })();
  async function initTemplates() {
    if (settings.local.templatesLoaded) return;
    settings.local.templatesLoaded = true;
    const result = await Ubi.fetch(`${Ubi.pluginBase}/templates/manifest.json`);
    if (!result.ok) {
      Ubi.log(`\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u53D6\u5F97\u5931\u6557 (${result.status})`, "error");
      return;
    }
    const data = JSON.parse(result.body);
    settings.local.templates = data;
    const thumbnailFiles = data.filter((t) => !!t.mappings.default).map((t) => ({
      id: t.id,
      url: `${Ubi.pluginBase}/templates/${t.directory}/${t.mappings.default}`
    }));
    AvatarEvents.sendToHost("avatar:initThumbnails", { thumbnailFiles });
  }
  var actions = {
    onApplyTemplate(id) {
      if (settings.local.pendingTemplateId === id) return;
      const template = settings.local.templates.find((t) => t.id === id);
      if (!template) return;
      settings.batch(() => {
        settings.local.pendingTemplateId = id;
        settings.local.currentTemplateId = id;
      });
      const files = Object.entries(template.mappings).filter((entry) => !!entry[1]).map(([state, filename]) => ({
        state,
        url: `${Ubi.pluginBase}/templates/${template.directory}/${filename}`
      }));
      AvatarEvents.sendToHost("avatar:applyTemplate", { files });
      setTimeout(() => {
        if (settings.local.pendingTemplateId === id) settings.local.pendingTemplateId = null;
      }, 1e4);
    },
    onResetToDefault() {
      if (settings.local.pendingTemplateId !== null) return;
      settings.batch(() => {
        settings.local.currentTemplateId = null;
        settings.local.avatar = { states: {} };
      });
      AvatarEvents.sendToHost("avatar:resetTemplate", {});
    },
    onCursorImageUrlChange(stateKey, url) {
      const cur = settings.local.avatar.states[stateKey];
      const hotspot = cur?.hotspot ?? { x: 0, y: 0 };
      const next = {
        ...settings.local.avatar,
        states: { ...settings.local.avatar.states, [stateKey]: { url, hotspot } }
      };
      settings.local.avatar = next;
      AvatarEvents.sendToHost("user:update", { avatar: next });
    }
  };
  function render() {
    const view = {
      templates: settings.local.templates,
      currentTemplateId: settings.local.currentTemplateId,
      pendingTemplateId: settings.local.pendingTemplateId,
      thumbnailUrls: settings.local.thumbnailUrls,
      cursorStyle: settings.local.cursorStyle,
      avatar: settings.local.avatar
    };
    Ubi.ui.render(() => renderSettingsPanel(view, actions), "settings");
  }
  settings.onChange("templates", render);
  settings.onChange("currentTemplateId", render);
  settings.onChange("pendingTemplateId", render);
  settings.onChange("thumbnailUrls", render);
  settings.onChange("cursorStyle", render);
  settings.onChange("avatar", render);
  AvatarEvents.on("input:cursor_style", ({ style }) => {
    if (style !== settings.local.cursorStyle) settings.local.cursorStyle = style;
  });
  AvatarEvents.on("avatar:thumbnails", ({ thumbnails }) => {
    settings.local.thumbnailUrls = { ...settings.local.thumbnailUrls, ...thumbnails };
  });
  AvatarEvents.on("player:joined", (user) => {
    if (user.id === Ubi.myUserId && user.avatar) {
      settings.local.avatar = user.avatar;
      if (settings.local.pendingTemplateId !== null) settings.local.pendingTemplateId = null;
    }
  });
  void initTemplates();
  render();
})();
