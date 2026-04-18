"use strict";
(() => {
  // plugins/video-player/src/screen.worker.tsx
  var state = {
    playlist: [],
    currentIndex: 0,
    isPlaying: false,
    isVisible: false,
    volume: 0,
    loop: "none",
    shuffle: false,
    currentTime: 0,
    duration: 0,
    apiBase: "",
    seekNonce: 0
  };
  var _loaded = false;
  var _localTime = 0;
  var _localDuration = 0;
  var _lastBroadcastAt = 0;
  var TARGET = "main";
  function _loadTrack(autoPlay) {
    const track = state.playlist[state.currentIndex];
    if (!track) return;
    const endpoint = track.mode === "live" ? "live" : "video";
    const url = `${state.apiBase}/${endpoint}/${track.id}`;
    Ubi.media.load(url, TARGET, track.mode === "live" ? "hls" : "auto");
    if (autoPlay) Ubi.media.play(TARGET);
  }
  function _persistPartial(patch) {
    const id = Ubi.entityId;
    if (!id) return;
    void Ubi.world.updateEntity(id, { data: patch });
  }
  var ScreenSystem = (_entities, _dt, events) => {
    for (const event of events) {
      if (event.type === "entity:video-player:screen") {
        const entity = event.payload;
        const d = entity.data;
        if (!d) continue;
        const prev = state;
        const next = {
          playlist: d.playlist ?? prev.playlist,
          currentIndex: d.currentIndex ?? prev.currentIndex,
          isPlaying: d.isPlaying ?? prev.isPlaying,
          isVisible: d.isVisible ?? prev.isVisible,
          volume: d.volume ?? prev.volume,
          loop: d.loop ?? prev.loop,
          shuffle: d.shuffle ?? prev.shuffle,
          currentTime: d.currentTime ?? prev.currentTime,
          duration: d.duration ?? prev.duration,
          apiBase: d.apiBase ?? prev.apiBase,
          seekNonce: d.seekNonce ?? prev.seekNonce
        };
        const trackChanged = next.currentIndex !== prev.currentIndex;
        const playingChanged = next.isPlaying !== prev.isPlaying;
        const volumeChanged = next.volume !== prev.volume;
        const visibilityChanged = next.isVisible !== prev.isVisible;
        const seeked = !trackChanged && next.seekNonce !== prev.seekNonce && _loaded;
        state = next;
        if (volumeChanged) Ubi.media.setVolume(next.volume, TARGET);
        if (visibilityChanged) Ubi.media.setVisible(next.isVisible, TARGET);
        if (trackChanged) {
          _loaded = false;
          _localTime = 0;
          _loadTrack(next.isPlaying);
        } else if (playingChanged) {
          if (next.isPlaying) {
            if (!_loaded) _loadTrack(true);
            else Ubi.media.play(TARGET);
          } else {
            Ubi.media.pause(TARGET);
          }
        } else if (seeked) {
          Ubi.media.seek(next.currentTime, TARGET);
          _localTime = next.currentTime;
        }
      }
      if (event.type === "media:timeUpdate") {
        const p = event.payload;
        if (p.targetId !== TARGET) continue;
        _localTime = p.currentTime;
        _localDuration = p.duration;
        const now = Date.now();
        if (state.isPlaying && now - _lastBroadcastAt >= 2e3) {
          _lastBroadcastAt = now;
          Ubi.network.broadcast("vp:timeSync", {
            currentTime: _localTime,
            currentIndex: state.currentIndex
          });
        }
      }
      if (event.type === "media:loaded") {
        const p = event.payload;
        if (p.targetId !== TARGET) continue;
        _loaded = true;
        _localDuration = p.duration;
        if (_localDuration > 0) _persistPartial({ duration: _localDuration });
        if (state.currentTime > 3 && state.playlist[state.currentIndex]?.mode !== "live") {
          Ubi.media.seek(state.currentTime, TARGET);
          _localTime = state.currentTime;
        }
      }
      if (event.type === "media:ended") {
        const p = event.payload;
        if (p.targetId !== TARGET) continue;
        if (state.loop === "track") {
          Ubi.media.seek(0, TARGET);
          Ubi.media.play(TARGET);
          continue;
        }
        const nextIdx = state.shuffle ? Math.floor(Math.random() * state.playlist.length) : state.currentIndex + 1;
        if (!state.shuffle && nextIdx >= state.playlist.length) {
          if (state.loop === "playlist" && state.playlist.length > 0) {
            state = { ...state, currentIndex: 0, currentTime: 0, isPlaying: true };
          } else {
            state = { ...state, isPlaying: false };
          }
        } else {
          state = { ...state, currentIndex: nextIdx, currentTime: 0 };
        }
        _loaded = false;
        _localTime = 0;
        if (state.isPlaying) _loadTrack(true);
        _persistPartial({ currentIndex: state.currentIndex, currentTime: 0, isPlaying: state.isPlaying });
      }
      if (event.type === "media:error") {
        const p = event.payload;
        if (p.targetId === TARGET) Ubi.log(`[Screen] media error: ${p.message}`, "warn");
      }
    }
  };
  void (async () => {
    const entityId = Ubi.entityId;
    if (!entityId) return;
    try {
      const entity = await Ubi.world.getEntity(entityId);
      if (entity?.data) {
        const d = entity.data;
        state = {
          playlist: d.playlist ?? [],
          currentIndex: d.currentIndex ?? 0,
          isPlaying: d.isPlaying ?? false,
          isVisible: d.isVisible ?? false,
          volume: d.volume ?? 0,
          loop: d.loop ?? "none",
          shuffle: d.shuffle ?? false,
          currentTime: d.currentTime ?? 0,
          duration: d.duration ?? 0,
          apiBase: d.apiBase ?? "",
          seekNonce: d.seekNonce ?? 0
        };
      }
    } catch (err) {
      Ubi.log(`[Screen] init error: ${String(err)}`, "error");
    }
    Ubi.media.setVolume(state.volume, TARGET);
    Ubi.media.setVisible(state.isVisible, TARGET);
    if (state.playlist.length > 0 && state.isPlaying) {
      _loadTrack(true);
    }
    const selfId = entityId;
    setInterval(() => {
      if (state.isPlaying && _loaded) {
        void Ubi.world.updateEntity(selfId, { data: { currentTime: _localTime } });
      }
    }, 3e3);
  })();
  Ubi.registerSystem(ScreenSystem);
})();
