(function initPageBridge() {
  "use strict";

  let lastFingerprint = "";
  let pollTimer = null;

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
    return candidates.find((candidate) => candidate?.videoDetails || candidate?.captions) || null;
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
            || String(track.vssId || "").startsWith("a.")
            || /(?:[?&])caps=asr(?:[&#]|$)/.test(String(track.baseUrl || "")),
          isTranslatable: track.isTranslatable !== false
        }))
      : [];
    const translationLanguages = Array.isArray(renderer?.translationLanguages)
      ? renderer.translationLanguages.map((language) => ({
          languageCode: language.languageCode || "",
          name: textOf(language.languageName)
        }))
      : [];
    return {
      videoId: response?.videoDetails?.videoId || new URL(location.href).searchParams.get("v") || "",
      title: response?.videoDetails?.title || document.title.replace(/\s+-\s+YouTube$/, ""),
      channelId: response?.videoDetails?.channelId || "",
      channelName: response?.videoDetails?.author || "",
      captionTracks,
      translationLanguages
    };
  }

  function emitPlayerData(event) {
    try {
      const data = sanitize(findResponse(event));
      if (!data.videoId) return;
      const fingerprint = JSON.stringify(data);
      if (fingerprint === lastFingerprint) return;
      lastFingerprint = fingerprint;
      document.dispatchEvent(new CustomEvent("ytlang:player-data", { detail: data }));
    } catch (error) {
      document.dispatchEvent(new CustomEvent("ytlang:bridge-error", {
        detail: { message: String(error?.message || error) }
      }));
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
      descriptor.translationLanguage = { languageCode: plan.target.languageCode };
    }
    player.setOption?.("captions", "track", descriptor);
    ensureCaptionButton(true);
    window.setTimeout(() => {
      document.dispatchEvent(new CustomEvent("ytlang:apply-result", {
        detail: {
          ok: captionsButtonState(),
          videoId: plan.videoId,
          type: plan.type,
          languageCode: plan.track.languageCode,
          targetLanguageCode: plan.target?.languageCode || ""
        }
      }));
    }, 350);
  }

  document.addEventListener("ytlang:apply-plan", (event) => {
    try {
      applyPlan(event.detail);
    } catch (error) {
      document.dispatchEvent(new CustomEvent("ytlang:apply-result", {
        detail: { ok: false, message: String(error?.message || error) }
      }));
    }
  });

  document.addEventListener("ytlang:disable-captions", () => {
    ensureCaptionButton(false);
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
