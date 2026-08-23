(function initContentScript() {
  "use strict";

  const Core = globalThis.YTLangCore;
  if (!Core) return;

  let settings = Core.mergeSettings();
  let playerData = null;
  let activePlan = null;
  let applyAttempts = 0;
  let captionProbeState = "idle";
  const openccConverters = new Map();
  let processedSegments = new WeakMap();
  let originalSegmentText = new WeakMap();
  let lastCue = "";
  let captureBusy = false;
  let captureArmed = false;
  let pendingCue = null;
  let activeCueKey = "";
  let captureGeneration = 0;
  let detection = freshDetection();
  let observerActive = false;
  let observerStartTimer = 0;
  let openccLoadPromise = null;
  let lastSavedStatusJson = "";

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

  function freshDetection() {
    return {
      startedAt: 0,
      cueKeys: new Set(),
      samples: [],
      lastAnalysis: null,
      complete: false,
      detected: false,
      skipReason: ""
    };
  }

  function refreshCaptureState() {
    const skipReason = Core.embeddedDetectionSkipReason(playerData, settings);
    if (detection.skipReason && !skipReason) detection = freshDetection();
    captureArmed = settings.enabled && settings.embeddedDetection && Boolean(playerData?.videoId) && !skipReason;
    detection.skipReason = skipReason;
    if (skipReason) {
      captureGeneration += 1;
      pendingCue = null;
      activeCueKey = "";
      detection.complete = true;
    }
    syncCaptionMonitoring();
  }

  function storageGet(area, key) {
    return new Promise((resolve) => chrome.storage[area].get(key, resolve));
  }

  async function loadSettings() {
    const [synced, local] = await Promise.all([
      storageGet("sync", "settings"),
      storageGet("local", ["customReplacements", "channelRules"])
    ]);
    settings = Core.migrateStoredSettings({
      ...synced.settings,
      customReplacements: local.customReplacements || synced.settings?.customReplacements,
      channelRules: local.channelRules || synced.settings?.channelRules
    });
    if (synced.settings?.settingsVersion !== settings.settingsVersion
      || synced.settings?.customReplacements
      || synced.settings?.channelRules) {
      const { customReplacements, channelRules, ...syncSettings } = settings;
      await Promise.all([
        chrome.storage.sync.set({ settings: syncSettings }),
        chrome.storage.local.set({ customReplacements, channelRules })
      ]);
    }
    refreshCaptureState();
  }

  function statusSnapshot(extra = {}) {
    return {
      videoId: playerData?.videoId || "",
      title: playerData?.title || "",
      channelId: playerData?.channelId || "",
      channelName: playerData?.channelName || "",
      channelRuleMode: Core.channelRuleFor(playerData, settings)?.mode || "",
      planType: activePlan?.type || "none",
      sourceName: activePlan?.track?.name || "",
      sourceLanguageCode: activePlan?.track?.languageCode || "",
      targetName: activePlan?.target?.name || "",
      captureArmed,
      detectionSamples: detection.samples.length,
      detectionComplete: detection.complete,
      embeddedDetected: detection.detected,
      detectionSkipReason: detection.skipReason,
      lastDetectionScore: detection.lastAnalysis ? Math.round(detection.lastAnalysis.score * 100) : null,
      lastDetectionBand: detection.lastAnalysis ? Math.round(detection.lastAnalysis.bandCenter * 100) : null,
      ...extra
    };
  }

  function saveStatus(extra = {}) {
    const status = statusSnapshot(extra);
    const serialized = JSON.stringify(status);
    if (serialized === lastSavedStatusJson) return;
    lastSavedStatusJson = serialized;
    document.documentElement?.setAttribute("data-ytlang-content-state", `${status.videoId}:${status.planType}:${status.detectionSkipReason || "ready"}`);
    document.documentElement?.setAttribute("data-ytlang-detection-state", JSON.stringify({
      samples: status.detectionSamples,
      complete: status.detectionComplete,
      detected: status.embeddedDetected,
      score: status.lastDetectionScore,
      band: status.lastDetectionBand,
      captureError: status.captureError || "",
      evaluation: status.detectionEvaluation || null
    }));
    chrome.storage.local.set({ status });
  }

  function resetForVideo() {
    captureGeneration += 1;
    pendingCue = null;
    activeCueKey = "";
    activePlan = null;
    applyAttempts = 0;
    captionProbeState = "idle";
    lastCue = "";
    detection = freshDetection();
    processedSegments = new WeakMap();
    originalSegmentText = new WeakMap();
  }

  function selectAndApply() {
    if (!playerData) return;
    const channelRule = Core.channelRuleFor(playerData, settings);
    if (channelRule?.mode === "disabled") {
      activePlan = { type: "channel-disabled", reason: "channel-rule-disabled" };
      syncCaptionMonitoring();
      saveStatus();
      return;
    }
    activePlan = Core.chooseCaptionPlan(playerData, settings);
    syncCaptionMonitoring();
    saveStatus();
    if (!settings.autoEnableCaptions) return;
    if (activePlan.type === "toggle") {
      applyAttempts += 1;
      emitEvent("ytlang:enable-captions", { videoId: playerData.videoId });
      return;
    }
    if (activePlan.type === "none") {
      const alreadyProbed = captionProbeState !== "idle";
      if (Core.shouldProbeCaptionControl(playerData, settings, alreadyProbed)) {
        captionProbeState = "pending";
        emitEvent("ytlang:probe-captions", { videoId: playerData.videoId });
        return;
      }
      if (captionProbeState === "pending") return;
      document.dispatchEvent(new CustomEvent("ytlang:disable-captions"));
      return;
    }
    if (!activePlan.track) return;
    applyAttempts += 1;
    emitEvent("ytlang:apply-plan", { ...activePlan, videoId: playerData.videoId });
  }

  document.addEventListener("ytlang:player-data", (event) => {
    const next = eventDetail(event, "ytlang:player-data");
    if (!next?.videoId) return;
    if (playerData?.videoId !== next.videoId) resetForVideo();
    playerData = next;
    refreshCaptureState();
    selectAndApply();
  });

  document.addEventListener("ytlang:apply-result", (event) => {
    const result = eventDetail(event, "ytlang:apply-result") || {};
    if (result.type === "probe") {
      if (result.ok && result.videoId === playerData?.videoId) {
        captionProbeState = "success";
        playerData = { ...playerData, hasCaptionControl: true };
        activePlan = { type: "toggle", reason: "caption-control-probe" };
        refreshCaptureState();
      } else if (result.videoId === playerData?.videoId) {
        captionProbeState = "failed";
      }
      saveStatus({ applyOk: Boolean(result.ok), applyMessage: result.message || "" });
      return;
    }
    if (!result.ok && applyAttempts < 3) {
      window.setTimeout(selectAndApply, 700 * applyAttempts);
      return;
    }
    saveStatus({ applyOk: Boolean(result.ok), applyMessage: result.message || "" });
  });

  function getConverter(target) {
    if (openccConverters.has(target)) return openccConverters.get(target);
    if (!globalThis.OpenCC?.Converter) return null;
    const converter = globalThis.OpenCC.Converter({ from: "cn", to: target });
    openccConverters.set(target, converter);
    return converter;
  }

  function openccTarget() {
    const localMode = Core.isLocalTextConversionEnabled(settings);
    if (!localMode) return "";
    if (activePlan?.type === "opencc") return settings.taiwanTermsEnabled ? "twp" : "tw";
    return settings.taiwanTermsEnabled ? "twp" : "";
  }

  function ensureOpenCC() {
    if (globalThis.OpenCC?.Converter) return Promise.resolve(true);
    if (openccLoadPromise) return openccLoadPromise;
    openccLoadPromise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "ytlang:load-opencc" }, (response) => {
        resolve(!chrome.runtime.lastError && response?.ok && Boolean(globalThis.OpenCC?.Converter));
      });
    }).finally(() => { openccLoadPromise = null; });
    return openccLoadPromise;
  }

  function convertCaptionSegments() {
    if (!settings.enabled || !playerData?.videoId || activePlan?.type === "channel-disabled") return;
    const localMode = Core.isLocalTextConversionEnabled(settings);
    const target = openccTarget();
    if (target && !globalThis.OpenCC?.Converter) {
      ensureOpenCC().then((loaded) => {
        if (!loaded) {
          saveStatus({ conversionError: "opencc-load-failed" });
          return;
        }
        processedSegments = new WeakMap();
        originalSegmentText = new WeakMap();
        convertCaptionSegments();
      });
      return;
    }
    const converter = target ? getConverter(target) : null;
    for (const segment of document.querySelectorAll(".ytp-caption-segment")) {
      const current = segment.textContent || "";
      if (processedSegments.get(segment) === current) continue;
      let converted = localMode && settings.hongKongColloquialEnabled
        ? Core.applyHongKongColloquial(current)
        : current;
      if (converter) converted = converter(converted);
      if (Core.shouldApplyCustomReplacements(settings)) {
        converted = Core.applyLiteralReplacements(converted, settings.customReplacements);
      }
      processedSegments.set(segment, converted);
      originalSegmentText.set(segment, current);
      if (converted !== current) segment.textContent = converted;
    }
  }

  function playerElement() {
    return document.querySelector(".html5-video-player");
  }

  function videoRect() {
    const video = videoElement();
    if (!video) return null;
    const rect = video.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 80) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }

  function videoElement() {
    return document.querySelector("video.html5-main-video, video");
  }

  function sendCaptureRequest(rect) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: "ytlang:capture-frame",
        rect,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }
      }, (response) => resolve(chrome.runtime.lastError ? null : response));
    });
  }

  function captionMaskRects(videoRect) {
    const selectors = [
      ".ytp-caption-window-bottom",
      ".caption-window",
      ".ytp-caption-segment",
      "[class*='caption-window']:not(.ytp-caption-window-container)"
    ].join(",");
    const rects = [...document.querySelectorAll(selectors)].map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return Core.captionMaskRegions(videoRect, rects);
  }

  function analyzeVideoFrame(video) {
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
    const sourceY = Math.round(video.videoHeight * 0.45);
    const sourceHeight = video.videoHeight - sourceY;
    const width = Math.min(720, Math.max(180, video.videoWidth));
    const height = Math.max(54, Math.round(sourceHeight * (width / video.videoWidth)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(video, 0, sourceY, video.videoWidth, sourceHeight, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    return Core.analyzeBottomTextBand(pixels, width, height);
  }

  async function analyzeScreenshot(dataUrl, rect, masks) {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();

    const scaleX = image.naturalWidth / innerWidth;
    const scaleY = image.naturalHeight / innerHeight;
    const sourceX = Math.max(0, Math.round(rect.x * scaleX));
    const sourceWidth = Math.min(image.naturalWidth - sourceX, Math.round(rect.width * scaleX));
    const sourceHeight = Math.round(rect.height * scaleY * 0.55);
    const sourceY = Math.max(0, Math.round((rect.y + rect.height * 0.45) * scaleY));
    const width = Math.min(720, Math.max(180, sourceWidth));
    const height = Math.max(54, Math.round(sourceHeight * (width / sourceWidth)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const scaledMasks = masks.map((mask) => ({
      x: mask.x * (width / 720),
      y: mask.y * (height / 720),
      width: mask.width * (width / 720),
      height: mask.height * (height / 720)
    }));
    Core.maskPixelRegions(pixels, width, height, scaledMasks);
    return Core.analyzeBottomTextBand(pixels, width, height);
  }

  async function captureAndAnalyze() {
    const rect = videoRect();
    const video = videoElement();
    if (!rect || !video) return null;

    try {
      const result = analyzeVideoFrame(video);
      if (result) return result;
    } catch {}

    const response = await sendCaptureRequest(rect);
    if (!response?.ok || !response.dataUrl) {
      saveStatus({ captureError: response?.reason || "capture-unavailable" });
      return null;
    }
    return analyzeScreenshot(response.dataUrl, rect, captionMaskRects(rect));
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function sampleEmbeddedSubtitle(cueKey) {
    if (detection.complete || !captureArmed || detection.cueKeys.has(cueKey)) return;
    const generation = captureGeneration;
    const attempts = [];
    await delay(260);
    for (let index = 0; index < 2; index += 1) {
      if (generation !== captureGeneration || activeCueKey !== cueKey || detection.complete || !captureArmed) break;
      const result = await captureAndAnalyze();
      if (result) attempts.push(result);
      if (index === 0) await delay(560);
    }
    if (!attempts.length || generation !== captureGeneration) return;

    const result = attempts.reduce((best, candidate) => candidate.score > best.score ? candidate : best);
    detection.cueKeys.add(cueKey);
    detection.lastAnalysis = result;
    detection.samples.push({ cueKey, ...result });
    const evaluation = Core.evaluateEmbeddedSamples(detection.samples);
    saveStatus({ detectionEvaluation: evaluation });
    if (evaluation.decision === "detected") {
      detection.complete = true;
      detection.detected = true;
      syncCaptionMonitoring();
      document.dispatchEvent(new CustomEvent("ytlang:disable-captions"));
      showToast(`偵測到影片內嵌字幕，已關閉 CC（信心 ${evaluation.confidence}%）`, true);
    } else if (evaluation.decision === "not-detected") {
      detection.complete = true;
      syncCaptionMonitoring();
    }
  }

  async function processCaptureQueue() {
    if (captureBusy) return;
    captureBusy = true;
    try {
      while (pendingCue && !detection.complete && captureArmed) {
        const cueKey = pendingCue;
        pendingCue = null;
        await sampleEmbeddedSubtitle(cueKey);
      }
    } catch (error) {
      saveStatus({ captureError: String(error?.message || error) });
    } finally {
      captureBusy = false;
      if (pendingCue && !detection.complete && captureArmed) processCaptureQueue();
    }
  }

  function queueEmbeddedSample(cueKey) {
    if (detection.cueKeys.has(cueKey)) return;
    pendingCue = cueKey;
    processCaptureQueue();
  }

  function handleCue(text) {
    const normalized = Core.normalizeCueText(text);
    if (!Core.isUsefulCue(normalized) || normalized === lastCue) return;
    lastCue = normalized;
    activeCueKey = normalized.toLocaleLowerCase().slice(0, 80);
    convertCaptionSegments();
    if (!settings.embeddedDetection || detection.complete) return;
    if (!detection.startedAt) detection.startedAt = Date.now();
    if (Date.now() - detection.startedAt > 90_000 || detection.samples.length >= 6) {
      detection.complete = true;
      syncCaptionMonitoring();
      saveStatus();
      return;
    }
    queueEmbeddedSample(activeCueKey);
  }

  function readCaptionText() {
    const text = [...document.querySelectorAll(".ytp-caption-segment")]
      .map((segment) => {
        const current = segment.textContent || "";
        return processedSegments.get(segment) === current
          ? originalSegmentText.get(segment) || current
          : current;
      })
      .join(" ");
    if (text) handleCue(text);
  }

  const observer = new MutationObserver(() => {
    convertCaptionSegments();
    readCaptionText();
  });

  function captionMonitoringNeeded() {
    return Core.shouldMonitorCaptions(settings, {
      documentHidden: document.visibilityState === "hidden",
      hasVideo: Boolean(playerData?.videoId),
      hasCaptionTracks: Boolean(playerData?.captionTracks?.length) || playerData?.hasCaptionControl === true,
      hasRenderedCaptionCue: playerData?.hasRenderedCaptionCue === true,
      planType: activePlan?.type,
      captureArmed,
      detectionComplete: detection.complete
    });
  }

  function syncCaptionMonitoring() {
    if (observerStartTimer) window.clearTimeout(observerStartTimer);
    observerStartTimer = 0;
    if (!captionMonitoringNeeded()) {
      if (observerActive) observer.disconnect();
      observerActive = false;
      return;
    }
    if (!document.body) {
      observerStartTimer = window.setTimeout(syncCaptionMonitoring, 30);
      return;
    }
    if (!observerActive) {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      observerActive = true;
      convertCaptionSegments();
      readCaptionText();
    }
  }

  document.addEventListener("visibilitychange", syncCaptionMonitoring);

  function showToast(message, offerUndo = false) {
    const player = playerElement();
    if (!player) return;
    player.querySelector(".ytlang-toast")?.remove();
    const toast = document.createElement("div");
    toast.className = "ytlang-toast";
    toast.setAttribute("role", "status");
    const label = document.createElement("span");
    label.textContent = message;
    toast.append(label);
    if (offerUndo) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "復原 CC";
      button.addEventListener("click", () => {
        detection.detected = false;
        detection.complete = true;
        selectAndApply();
        toast.remove();
      });
      toast.append(button);
    }
    player.append(toast);
    window.setTimeout(() => toast.remove(), offerUndo ? 1000 : 3800);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "ytlang:settings-updated") {
      settings = Core.mergeSettings(message.settings);
      resetForVideo();
      refreshCaptureState();
      selectAndApply();
      sendResponse({ ok: true, status: statusSnapshot() });
      return false;
    }
    if (message?.type === "ytlang:get-status") {
      sendResponse({ ok: true, status: statusSnapshot() });
      return false;
    }
    if (message?.type === "ytlang:reapply") {
      resetForVideo();
      refreshCaptureState();
      selectAndApply();
      showToast("已重新套用字幕規則");
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  loadSettings().then(() => {
    syncCaptionMonitoring();
    saveStatus();
  });
})();
