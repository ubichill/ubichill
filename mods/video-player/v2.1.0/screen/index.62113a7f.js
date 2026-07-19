"use strict";
(() => {
  // mods/video-player/src/events.ts
  var VPTarget = {
    screen: { scope: "siblings", targetType: "video-player:screen" },
    controls: { scope: "siblings", targetType: "video-player:controls" },
    playlist: { scope: "siblings", targetType: "video-player:playlist" },
    siblings: { scope: "siblings" }
  };
  var VPEvents = Ubi.event.define();

  // mods/video-player/src/screen.worker.tsx
  var TARGET = "main";
  Ubi.media.setVisible(true, TARGET);
  VPEvents.on("vp:media:load", ({ url, mode }) => {
    Ubi.media.load(url, TARGET, mode === "live" ? "hls" : "auto");
  });
  VPEvents.on("vp:media:play", () => Ubi.media.play(TARGET));
  VPEvents.on("vp:media:pause", () => Ubi.media.pause(TARGET));
  VPEvents.on("vp:media:seek", ({ time }) => Ubi.media.seek(time, TARGET));
  VPEvents.on("vp:media:volume", ({ volume }) => Ubi.media.setVolume(volume, TARGET));
  VPEvents.on("media:loaded", ({ targetId, duration }) => {
    if (targetId !== TARGET) return;
    VPEvents.emit("vp:media:loaded", { duration }, VPTarget.controls);
  });
  VPEvents.on("media:ended", ({ targetId }) => {
    if (targetId !== TARGET) return;
    VPEvents.emit("vp:media:ended", {}, VPTarget.controls);
  });
  VPEvents.on("media:error", ({ targetId, message }) => {
    if (targetId !== TARGET) return;
    Ubi.log(`[screen] media error: ${message}`, "warn");
  });
})();
