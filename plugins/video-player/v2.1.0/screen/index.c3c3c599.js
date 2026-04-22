"use strict";
(() => {
  // plugins/video-player/src/system/screen.ts
  var TARGET = "main";
  var DEFAULT_API_BASE = "/plugins/video-player/api";
  var state = Ubi.state.define({
    // 共有フィールド (entity.data に保存される)
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
    // 音量はユーザーごと (entity.data[`myVolume:<userId>`])
    myVolume: Ubi.state.persistMine(0.7),
    // ローカル専用
    loaded: false,
    localTime: 0,
    localDuration: 0,
    lastBroadcastAt: 0
  });
  function _loadTrack(autoPlay) {
    const track = state.local.playlist[state.local.currentIndex];
    if (!track) return;
    const apiBase = state.local.apiBase.trim() || DEFAULT_API_BASE;
    const endpoint = track.mode === "live" ? "live" : "video";
    const url = `${apiBase}/${endpoint}/${track.id}`;
    Ubi.media.load(url, TARGET, track.mode === "live" ? "hls" : "auto");
    if (autoPlay) Ubi.media.play(TARGET);
  }
  state.onChange("currentIndex", () => {
    state.local.loaded = false;
    state.local.localTime = 0;
    _loadTrack(state.local.isPlaying);
  });
  state.onChange("isPlaying", (playing) => {
    Ubi.log(
      `[Screen:onChange] isPlaying=${playing} loaded=${state.local.loaded} playlist=${state.local.playlist.length}`,
      "info"
    );
    if (playing) {
      if (!state.local.loaded) _loadTrack(true);
      else Ubi.media.play(TARGET);
    } else {
      Ubi.media.pause(TARGET);
    }
  });
  state.onChange("isVisible", (visible) => {
    Ubi.media.setVisible(visible, TARGET);
  });
  state.onChange("seekNonce", () => {
    if (!state.local.loaded) return;
    Ubi.media.seek(state.local.currentTime, TARGET);
    state.local.localTime = state.local.currentTime;
  });
  state.onChange("myVolume", (v) => {
    Ubi.media.setVolume(v, TARGET);
  });
  var ScreenSystem = (_entities, _dt, events) => {
    for (const event of events) {
      if (event.type === "media:timeUpdate") {
        const p = event.payload;
        if (p.targetId !== TARGET) continue;
        state.local.localTime = p.currentTime;
        state.local.localDuration = p.duration;
        const now = Date.now();
        if (state.local.isPlaying && now - state.local.lastBroadcastAt >= 2e3) {
          state.local.lastBroadcastAt = now;
          Ubi.network.broadcast("vp:timeSync", {
            currentTime: state.local.localTime,
            currentIndex: state.local.currentIndex
          });
        }
        continue;
      }
      if (event.type === "media:loaded") {
        const p = event.payload;
        if (p.targetId !== TARGET) continue;
        state.local.loaded = true;
        state.local.localDuration = p.duration;
        if (state.local.localDuration > 0) state.local.duration = state.local.localDuration;
        const _track = state.local.playlist[state.local.currentIndex];
        if (state.local.currentTime > 0 && _track?.mode !== "live") {
          Ubi.media.seek(state.local.currentTime, TARGET);
          state.local.localTime = state.local.currentTime;
        }
        if (state.local.isPlaying) {
          Ubi.media.play(TARGET);
        }
        continue;
      }
      if (event.type === "media:ended") {
        const p = event.payload;
        if (p.targetId !== TARGET) continue;
        if (state.local.loop === "track") {
          Ubi.media.seek(0, TARGET);
          Ubi.media.play(TARGET);
          continue;
        }
        const nextIdx = state.local.shuffle ? Math.floor(Math.random() * state.local.playlist.length) : state.local.currentIndex + 1;
        if (!state.local.shuffle && nextIdx >= state.local.playlist.length) {
          if (state.local.loop === "playlist" && state.local.playlist.length > 0) {
            state.local.currentIndex = 0;
            state.local.currentTime = 0;
            state.local.isPlaying = true;
          } else {
            state.local.isPlaying = false;
          }
        } else {
          state.local.currentIndex = nextIdx;
          state.local.currentTime = 0;
        }
        continue;
      }
      if (event.type === "media:error") {
        const p = event.payload;
        if (p.targetId === TARGET) Ubi.log(`[Screen] media error: ${p.message}`, "warn");
      }
    }
  };
  function initScreen() {
    state.local.apiBase = state.local.apiBase.trim() || DEFAULT_API_BASE;
    Ubi.log(
      `[Screen:init] playlist=${state.local.playlist.length} isPlaying=${state.local.isPlaying} isVisible=${state.local.isVisible} currentTime=${state.local.currentTime}`,
      "info"
    );
    if (state.local.playlist.length > 0 && state.local.isPlaying) {
      _loadTrack(true);
    } else if (state.local.playlist.length > 0) {
      _loadTrack(false);
    }
    Ubi.media.setVisible(state.local.isVisible, TARGET);
    Ubi.media.setVolume(state.local.myVolume, TARGET);
    setInterval(() => {
      if (state.local.isPlaying && state.local.loaded) {
        state.local.currentTime = state.local.localTime;
      }
    }, 3e3);
  }

  // plugins/video-player/src/screen.worker.tsx
  Ubi.registerSystem(ScreenSystem);
  initScreen();
})();
