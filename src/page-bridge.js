(function initPageBridge() {
  "use strict";

  let lastFingerprint = "";
  let pollTimer = null;
  let renderedCaptionVideoId = "";
  let hasSeenRenderedCaptionCue = false;
  const bestDataByVideoId = new Map();

  function eventDataAttribute(type) {
    return `data-${type.replace(/:/g, "-")}`;
  }

  function emitEvent(type, detail) {
    if (detail !== undefined) {
      document.documentElement?.setAttribute(eventDataAttribute(type), JSON.stringify(detail));
    }
    document.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function eventDetail(event, type) {
    if (event?.detail && typeof event.detail === "object") return event.detail;
    try {
      return JSON.parse(document.documentElement?.getAttribute(eventDataAttribute(type)) || "null");
    } catch {
      return null;
    }
  }

  function textOf(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
    return "";
  }

  function getPlayer() {
    return document.getElementById("movie_player");
  }

  function findResponse(event) {
    const detail = event?.detail;
    const candidates = [
      detail?.response?.playerResponse,
      detail?.playerResponse,
      detail?.response,
      getPlayer()?.getPlayerResponse?.(),
      window.ytInitialPlayerResponse
    ];
    return candidates
      .filter((candidate) => candidate?.videoDetails || candidate?.captions)
      .sort((left, right) => {
        const count = (candidate) => candidate?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length || 0;
        return count(right) - count(left);
      })[0] || null;
  }

  function captionControlAvailable() {
    return captionsButtonState() || hasSeenRenderedCaptionCue;
  }

  function sanitize(response) {
    const renderer = response?.captions?.playerCaptionsTracklistRenderer;
    const captionTracks = Array.isArray(renderer?.captionTracks)
      ? renderer.captionTracks.map((track) => ({
          languageCode: track.languageCode || "",
          name: textOf(track.name),
          kind: track.kind || "",
          vssId: track.vssId || "",
          isAutomatic: track.kind === "asr"
            || String(track.vssId || "").startsWith("a."),
          isTranslatable: track.isTranslatable !== false
        }))
      : [];
    const translationLanguages = Array.isArray(renderer?.translationLanguages)
      ? renderer.translationLanguages.map((language) => ({
          languageCode: language.languageCode || "",
          name: textOf(language.languageName)
        }))
      : [];
    const videoId = response?.videoDetails?.videoId || new URL(location.href).searchParams.get("v") || "";
    if (renderedCaptionVideoId !== videoId) {
      renderedCaptionVideoId = videoId;
      hasSeenRenderedCaptionCue = false;
    } else if (document.querySelector(".ytp-caption-segment")?.textContent?.trim()) {
      hasSeenRenderedCaptionCue = true;
    }
    const next = {
      videoId,
      title: response?.videoDetails?.title || document.title.replace(/\s+-\s+YouTube$/, ""),
      channelId: response?.videoDetails?.channelId || "",
      channelName: response?.videoDetails?.author || "",
      captionTracks,
      translationLanguages,
      hasRenderedCaptionCue: hasSeenRenderedCaptionCue,
      hasCaptionControl: captionControlAvailable()
    };
    const previous = bestDataByVideoId.get(videoId);
    if (previous?.captionTracks?.length && !next.captionTracks.length) {
      next.captionTracks = previous.captionTracks;
      next.translationLanguages = previous.translationLanguages;
    }
    if (!next.channelId && previous?.channelId) {
      next.channelId = previous.channelId;
      next.channelName = previous.channelName;
    }
    bestDataByVideoId.set(videoId, next);
    return next;
  }

  function emitPlayerData(event) {
    try {
      const data = sanitize(findResponse(event));
      if (!data.videoId) return;
      const fingerprint = JSON.stringify(data);
      if (fingerprint === lastFingerprint) return;
      lastFingerprint = fingerprint;
      document.documentElement?.setAttribute("data-ytlang-bridge-state", `player-data:${data.videoId}:${data.captionTracks.length}`);
      emitEvent("ytlang:player-data", data);
    } catch (error) {
      emitEvent("ytlang:bridge-error", { message: String(error?.message || error) });
    }
  }

  function captionsButtonState() {
    const button = document.querySelector(".ytp-subtitles-button");
    return button?.getAttribute("aria-pressed") === "true";
  }

  function ensureCaptionButton(enabled) {
    const button = document.querySelector(".ytp-subtitles-button");
    if (!button || button.disabled) return false;
    if (captionsButtonState() !== enabled) button.click();
    return true;
  }

  function applyPlan(plan) {
    const player = getPlayer();
    if (!player || !plan?.track) throw new Error("播放器或字幕軌尚未就緒");

    player.loadModule?.("captions");
    const descriptor = {
      languageCode: plan.track.languageCode,
      vssId: plan.track.vssId,
      kind: plan.track.kind || undefined
    };
    if (plan.type === "translate" && plan.target?.languageCode) {
      descriptor.translationLanguage = {
        languageCode: plan.target.languageCode,
        languageName: plan.target.name || plan.target.languageName || plan.target.languageCode
      };
    }
    player.setOption?.("captions", "track", descriptor);
    ensureCaptionButton(true);
    window.setTimeout(() => {
      emitEvent("ytlang:apply-result", {
        ok: captionsButtonState(),
        videoId: plan.videoId,
        type: plan.type,
        languageCode: plan.track.languageCode,
        targetLanguageCode: plan.target?.languageCode || ""
      });
    }, 350);
  }

  document.addEventListener("ytlang:apply-plan", (event) => {
    try {
      applyPlan(eventDetail(event, "ytlang:apply-plan"));
    } catch (error) {
      emitEvent("ytlang:apply-result", { ok: false, message: String(error?.message || error) });
    }
  });

  document.addEventListener("ytlang:disable-captions", () => {
    ensureCaptionButton(false);
  });

  document.addEventListener("ytlang:enable-captions", (event) => {
    const detail = eventDetail(event, "ytlang:enable-captions");
    const ok = ensureCaptionButton(true);
    window.setTimeout(() => {
      emitEvent("ytlang:apply-result", {
        ok: ok && captionsButtonState(),
        videoId: detail?.videoId || "",
        type: "toggle"
      });
    }, 350);
  });

  function finishCaptionProbe(videoId, ok, message) {
    document.documentElement?.setAttribute("data-ytlang-bridge-state", `probe:${videoId}:${ok ? "ok" : message}`);
    emitEvent("ytlang:apply-result", { ok, videoId, type: "probe", message });
    if (ok) emitPlayerData();
  }

  function probeCaptionButtonWhenReady(videoId, attempt = 0) {
    const button = document.querySelector(".ytp-subtitles-button");
    const video = document.querySelector("video.html5-main-video, video");
    if ((!button || !video || video.readyState < 2) && attempt < 50) {
      window.setTimeout(() => probeCaptionButtonWhenReady(videoId, attempt + 1), 200);
      return;
    }
    if (!button || !video || video.readyState < 2) {
      finishCaptionProbe(videoId, false, "caption-control-not-ready");
      return;
    }
    const clicked = ensureCaptionButton(true);
    window.setTimeout(() => {
      const ok = clicked && captionsButtonState();
      finishCaptionProbe(
        videoId,
        ok,
        ok ? "caption-control-probe-ok" : "caption-control-probe-empty"
      );
    }, 900);
  }

  document.addEventListener("ytlang:probe-captions", (event) => {
    const detail = eventDetail(event, "ytlang:probe-captions");
    document.documentElement?.setAttribute("data-ytlang-bridge-state", `probe-received:${detail?.videoId || ""}`);
    probeCaptionButtonWhenReady(detail?.videoId || "");
  });

  for (const eventName of ["yt-navigate-finish", "yt-page-data-updated", "yt-page-data-fetched"]) {
    document.addEventListener(eventName, (event) => {
      lastFingerprint = "";
      window.setTimeout(() => emitPlayerData(event), 50);
      window.setTimeout(() => emitPlayerData(), 650);
    }, true);
  }

  function startPolling() {
    if (pollTimer) return;
    let attempts = 0;
    pollTimer = window.setInterval(() => {
      emitPlayerData();
      attempts += 1;
      if (attempts >= 40 && document.visibilityState === "hidden") {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 750);
  }

  startPolling();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      startPolling();
      emitPlayerData();
    }
  });
})();
