"use strict";
(() => {
  // plugins/avatar/src/state.ts
  var settings = {
    templates: [],
    currentTemplateId: null,
    templatesLoaded: false,
    thumbnailUrls: /* @__PURE__ */ new Map(),
    dirty: true,
    cursorStyle: "default",
    avatar: { states: {} },
    zIndex: 9998
  };

  // packages/engine/src/ecs/types.ts
  var EcsEventType = {
    PLAYER_JOINED: "player:joined",
    PLAYER_LEFT: "player:left",
    PLAYER_CURSOR_MOVED: "player:cursor_moved",
    ENTITY_UPDATED: "entity:updated",
    /** 入力イベント — Host が毎フレーム全 Worker へ配信 */
    INPUT_MOUSE_MOVE: "input:mouse_move",
    INPUT_MOUSE_DOWN: "input:mouse_down",
    INPUT_MOUSE_UP: "input:mouse_up",
    INPUT_KEY_DOWN: "input:key_down",
    INPUT_KEY_UP: "input:key_up",
    /** 右クリック（コンテキストメニュー）— payload: { x, y } */
    INPUT_CONTEXT_MENU: "input:context_menu",
    /** スクロール — payload: { x: scrollLeft, y: scrollTop } */
    INPUT_SCROLL: "input:scroll",
    /** ウィンドウリサイズ — payload: { width: number; height: number } */
    INPUT_RESIZE: "input:resize",
    /** カーソルスタイル変化 — payload: { style: string } */
    INPUT_CURSOR_STYLE: "input:cursor_style",
    /**
     * 他ユーザーの Worker が Ubi.network.broadcast() で送ったデータ。
     * payload: { userId: string; data: unknown }
     * event.type が broadcast の type 文字列になるため、このキーで比較するのではなく
     * broadcast 時に指定した type 文字列で比較すること。
     */
    NETWORK_BROADCAST: "network:broadcast",
    /** OffscreenCanvas のリサイズ通知。payload: { targetId: string; width: number; height: number } */
    CANVAS_RESIZE: "canvas:resize",
    /**
     * Host からプラグイン Worker へのカスタムメッセージ。
     * payload: { type: string; payload: unknown }
     * GenericPluginHost の sendHostMessage() で送信する。
     */
    HOST_MESSAGE: "host:message"
  };

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

  // plugins/avatar/src/systems/utils.ts
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

  // plugins/avatar/src/ui/SettingsPanel.tsx
  var _pendingTemplateId = null;
  function resetToDefault() {
    if (_pendingTemplateId !== null) return;
    settings.currentTemplateId = null;
    settings.avatar = { states: {} };
    settings.dirty = true;
    Ubi.network.sendToHost("avatar:resetTemplate", {});
  }
  function applyTemplate(templateId) {
    if (_pendingTemplateId === templateId) return;
    const template = settings.templates.find((t) => t.id === templateId);
    if (!template) return;
    _pendingTemplateId = templateId;
    settings.currentTemplateId = templateId;
    settings.dirty = true;
    const files = Object.entries(template.mappings).filter((entry) => !!entry[1]).map(([state, filename]) => ({
      state,
      url: `${Ubi.pluginBase}/templates/${template.directory}/${filename}`
    }));
    Ubi.log(`[applyTemplate] ${templateId}: ${files.map((f) => `${f.state}=${f.url}`).join(", ")}`, "info");
    Ubi.network.sendToHost("avatar:applyTemplate", { files });
    setTimeout(() => {
      if (_pendingTemplateId === templateId) {
        _pendingTemplateId = null;
        settings.dirty = true;
      }
    }, 1e4);
  }
  function clearPendingTemplate(templateId) {
    if (_pendingTemplateId === templateId) {
      _pendingTemplateId = null;
      settings.dirty = true;
    }
  }
  var SettingsPanel = () => {
    const cursorState = cssToState(settings.cursorStyle);
    const currentStateDef = settings.avatar.states[cursorState] ?? settings.avatar.states.default;
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
          settings.templates.length === 0 ? /* @__PURE__ */ jsx("div", { style: { color: "#868e96", fontSize: "12px", textAlign: "center", padding: "16px 0" }, children: "\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D..." }) : /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "8px",
                marginBottom: "12px"
              },
              children: settings.templates.map((t) => {
                const isSelected = settings.currentTemplateId === t.id;
                const isLoading = _pendingTemplateId === t.id;
                const hostThumb = settings.thumbnailUrls.get(t.id) ?? "";
                const thumbUrl = isSelected && !isLoading ? settings.avatar.states?.default?.url ?? hostThumb : hostThumb;
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
                    onUbiClick: () => applyTemplate(t.id),
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
          settings.currentTemplateId !== null && /* @__PURE__ */ jsx(
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
              onUbiClick: resetToDefault,
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
                  onUbiInput: (value) => {
                    const url = String(value);
                    const hotspot = currentStateDef?.hotspot ?? { x: 0, y: 0 };
                    settings.avatar = {
                      ...settings.avatar,
                      states: {
                        ...settings.avatar.states,
                        [cursorState]: { url, hotspot }
                      }
                    };
                    Ubi.network.sendToHost("user:update", { avatar: settings.avatar });
                  }
                }
              )
            ] })
          ] })
        ]
      }
    );
  };

  // plugins/avatar/src/systems/AvatarSettingsSystem.tsx
  async function initTemplates() {
    if (settings.templatesLoaded) return;
    settings.templatesLoaded = true;
    try {
      Ubi.log(`[initTemplates] pluginBase: ${Ubi.pluginBase}`, "info");
      const result = await Ubi.network.fetch(`${Ubi.pluginBase}/templates/manifest.json`);
      if (!result.ok) {
        Ubi.log(
          `\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u30DE\u30CB\u30D5\u30A7\u30B9\u30C8\u53D6\u5F97\u5931\u6557 (${result.status}): ${Ubi.pluginBase}/templates/manifest.json`,
          "error"
        );
        return;
      }
      const data = JSON.parse(result.body);
      Ubi.log(`[initTemplates] ${data.length} \u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u53D6\u5F97`, "info");
      settings.templates = data;
      settings.dirty = true;
      const thumbnailFiles = data.filter((t) => !!t.mappings.default).map((t) => ({
        id: t.id,
        url: `${Ubi.pluginBase}/templates/${t.directory}/${t.mappings.default}`
      }));
      Ubi.log(`[initTemplates] \u30B5\u30E0\u30CD\u30A4\u30EB\u9001\u4FE1: ${thumbnailFiles.map((f) => f.url).join(", ")}`, "info");
      Ubi.network.sendToHost("avatar:initThumbnails", { thumbnailFiles });
    } catch (err) {
      Ubi.log(`\u30C6\u30F3\u30D7\u30EC\u30FC\u30C8\u521D\u671F\u5316\u30A8\u30E9\u30FC: ${String(err)}`, "error");
    }
  }
  var AvatarSettingsSystem = (_entities, _deltaTime, events) => {
    void initTemplates();
    const myUserId = Ubi.myUserId;
    for (const event of events) {
      if (event.type === EcsEventType.INPUT_CURSOR_STYLE) {
        const d = event.payload;
        if (d.style !== settings.cursorStyle) {
          settings.cursorStyle = d.style;
          settings.dirty = true;
        }
      }
      if (event.type === EcsEventType.HOST_MESSAGE) {
        const msg = event.payload;
        if (msg.type === "avatar:thumbnails") {
          const { thumbnails } = msg.payload;
          Ubi.log(`[avatar:thumbnails] \u53D7\u4FE1: ${Object.keys(thumbnails).length} \u4EF6`, "info");
          for (const [id, url] of Object.entries(thumbnails)) {
            settings.thumbnailUrls.set(id, url);
          }
          settings.dirty = true;
        }
      }
      if (event.type === EcsEventType.PLAYER_JOINED) {
        const user = event.payload;
        if (user.id === myUserId && user.avatar) {
          settings.avatar = user.avatar;
          settings.dirty = true;
          if (settings.currentTemplateId !== null) {
            clearPendingTemplate(settings.currentTemplateId);
          }
        }
      }
    }
    if (settings.dirty) {
      settings.dirty = false;
      Ubi.ui.render(() => /* @__PURE__ */ jsx(SettingsPanel, {}), "settings");
    }
  };

  // plugins/avatar/src/settings.worker.tsx
  void (async () => {
    try {
      const entities = await Ubi.world.queryEntities("avatar:settings");
      if (entities.length > 0) {
        settings.zIndex = entities[0].transform.z;
        Ubi.log(`[Avatar Settings] zIndex: ${entities[0].transform.z}`, "info");
      }
    } catch {
    }
  })();
  Ubi.registerSystem(AvatarSettingsSystem);
  Ubi.log("initialized", "info");
})();
