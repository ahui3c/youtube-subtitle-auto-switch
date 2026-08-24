(function initPopup() {
  "use strict";

  const Core = globalThis.YTLangCore;
  const enabled = document.getElementById("enabled");
  const embeddedDetection = document.getElementById("embeddedDetection");
  const skipEmbeddedDetectionForSimplifiedOnly = document.getElementById("skipEmbeddedDetectionForSimplifiedOnly");
  const priorityList = document.getElementById("priority-list");
  const saveStatus = document.getElementById("save-status");
  const routeStatus = document.getElementById("route-status");
  const routeDetail = document.getElementById("route-detail");
  const detectorStatus = document.getElementById("detector-status");
  const simplifiedHint = document.getElementById("simplified-hint");
  const trackCount = document.getElementById("track-count");
  const taiwanTermsEnabled = document.getElementById("taiwanTermsEnabled");
  const hongKongColloquialEnabled = document.getElementById("hongKongColloquialEnabled");
  const termsSection = document.getElementById("terms-section");
  const customSection = document.getElementById("custom-section");
  const customReplacementsEnabled = document.getElementById("customReplacementsEnabled");
  const replacementForm = document.getElementById("replacement-form");
  const replacementFrom = document.getElementById("replacement-from");
  const replacementTo = document.getElementById("replacement-to");
  const replacementList = document.getElementById("replacement-list");
  const replacementError = document.getElementById("replacement-error");
  const currentChannelName = document.getElementById("current-channel-name");
  const currentChannelId = document.getElementById("current-channel-id");
  const addCurrentChannel = document.getElementById("add-current-channel");
  const channelRuleList = document.getElementById("channel-rule-list");
  const versionLabel = document.getElementById("version-label");
  const CHANNEL_MODE_LABELS = Object.freeze({
    disabled: "停用全部",
    "skip-ocr": "略過 OCR 字幕辨識",
    "force-ocr": "強制 OCR 字幕辨識",
    "force-enable-no-ocr": "強置開啟字幕，不 OCR 偵測",
    "force-disable-no-ocr": "強置關閉字幕，不 OCR 偵測"
  });
  const ACTION_ICON_SIZES = [16, 32, 48, 128];
  const actionImageDataCache = new Map();
  let settings = Core.mergeSettings();
  let activeTab = null;
  let currentStatus = null;

  function getSync(key) {
    return new Promise((resolve) => chrome.storage.sync.get(key, resolve));
  }

  function getLocal(key) {
    return new Promise((resolve) => chrome.storage.local.get(key, resolve));
  }

  function queryActiveTab() {
    return new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null)));
  }

  function sendToTab(message) {
    return new Promise((resolve) => {
      if (!activeTab?.id) return resolve(null);
      chrome.tabs.sendMessage(activeTab.id, message, (response) => resolve(chrome.runtime.lastError ? null : response));
    });
  }

  function sendToRuntime(message) {
    return Promise.resolve(chrome.runtime.sendMessage(message)).catch(() => null);
  }

  async function actionImageData(state) {
    if (actionImageDataCache.has(state)) return actionImageDataCache.get(state);
    const imageData = {};
    for (const size of ACTION_ICON_SIZES) {
      const image = new Image();
      image.src = chrome.runtime.getURL(`icons/${state}-${size}.png`);
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      imageData[size] = context.getImageData(0, 0, size, size);
    }
    actionImageDataCache.set(state, imageData);
    return imageData;
  }

  async function updateToolbarState(isEnabled) {
    const state = isEnabled ? "enabled" : "disabled";
    const path = Object.fromEntries(ACTION_ICON_SIZES.map((size) => [size, `icons/${state}-${size}.png`]));
    const updates = [
      sendToRuntime({ type: "ytlang:update-action-state", enabled: isEnabled })
    ];
    if (chrome.action?.setIcon) {
      updates.push(
        actionImageData(state)
          .then((imageData) => chrome.action.setIcon({ imageData }))
          .catch(() => chrome.action.setIcon({ path }))
      );
      updates.push(chrome.action.setBadgeText({ text: isEnabled ? "" : "OFF" }));
      updates.push(chrome.action.setBadgeBackgroundColor({ color: "#7A8288" }));
    }
    if (chrome.action?.setTitle) {
      updates.push(chrome.action.setTitle({
        title: `Youtube 字幕全自動開關：${isEnabled ? "已開啟" : "已關閉"}`
      }));
    }
    await Promise.allSettled(updates);
  }

  function renderPriority() {
    priorityList.replaceChildren();
    const disabledRules = new Set(settings.disabledRules);
    const firstEnabledId = settings.priority.find((id) => !disabledRules.has(id));
    trackCount.textContent = `${settings.priority.length - disabledRules.size}/${settings.priority.length} 軌`;
    settings.priority.forEach((id, index) => {
      const rule = Core.RULES.find((candidate) => candidate.id === id);
      if (!rule) return;
      const ruleEnabled = !disabledRules.has(id);
      const item = document.createElement("li");
      item.className = `track${ruleEnabled ? "" : " is-disabled"}${id === firstEnabledId ? " is-route-start" : ""}`;
      item.innerHTML = `<span class="track-index">${String(index + 1).padStart(2, "0")}</span><span class="track-name"></span>`;
      item.querySelector(".track-name").textContent = rule.label;
      const actions = document.createElement("div");
      actions.className = "track-actions";
      const toggle = document.createElement("label");
      toggle.className = "track-toggle";
      toggle.title = ruleEnabled ? "停用這條字幕規則" : "啟用這條字幕規則";
      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = ruleEnabled;
      toggleInput.setAttribute("aria-label", `${ruleEnabled ? "停用" : "啟用"}「${rule.label}」`);
      const toggleVisual = document.createElement("span");
      toggleVisual.setAttribute("aria-hidden", "true");
      toggleInput.addEventListener("change", () => toggleRule(id, toggleInput.checked));
      toggle.append(toggleInput, toggleVisual);
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.title = "提高優先順序";
      up.setAttribute("aria-label", `提高「${rule.label}」優先順序`);
      up.disabled = index === 0;
      up.addEventListener("click", () => move(index, index - 1));
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.title = "降低優先順序";
      down.setAttribute("aria-label", `降低「${rule.label}」優先順序`);
      down.disabled = index === settings.priority.length - 1;
      down.addEventListener("click", () => move(index, index + 1));
      actions.append(toggle, up, down);
      item.append(actions);
      priorityList.append(item);
    });
  }

  function renderSettings() {
    enabled.checked = settings.enabled;
    embeddedDetection.checked = settings.embeddedDetection;
    skipEmbeddedDetectionForSimplifiedOnly.checked = settings.skipEmbeddedDetectionForSimplifiedOnly;
    taiwanTermsEnabled.checked = settings.taiwanTermsEnabled;
    hongKongColloquialEnabled.checked = settings.hongKongColloquialEnabled;
    const localMode = settings.simplifiedMode === "opencc";
    taiwanTermsEnabled.disabled = !localMode;
    hongKongColloquialEnabled.disabled = !localMode;
    termsSection.classList.toggle("is-locked", !localMode);
    termsSection.setAttribute("aria-disabled", String(!localMode));
    customReplacementsEnabled.checked = settings.customReplacementsEnabled;
    customReplacementsEnabled.disabled = !localMode;
    customSection.classList.toggle("is-locked", !localMode);
    customSection.setAttribute("aria-disabled", String(!localMode));
    for (const control of replacementForm.elements) control.disabled = !localMode;
    const radio = document.querySelector(`input[name="simplifiedMode"][value="${settings.simplifiedMode}"]`);
    if (radio) radio.checked = true;
    simplifiedHint.textContent = settings.simplifiedMode === "youtube"
      ? "由 YouTube 將簡體字幕自動翻譯為繁體中文，結果與時間切分由 YouTube 控制。"
      : "本機轉換不會送出字幕文字，並保留原始時間軸。";
    renderPriority();
    renderReplacements();
    renderChannelRules();
    renderCurrentChannel();
  }

  function renderReplacements() {
    replacementList.replaceChildren();
    const localMode = settings.simplifiedMode === "opencc";
    settings.customReplacements.forEach((rule, index) => {
      const item = document.createElement("li");
      item.className = `replacement-item${rule.enabled ? "" : " is-disabled"}`;
      const toggle = document.createElement("label");
      toggle.className = "track-toggle";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = rule.enabled;
      input.disabled = !localMode;
      input.setAttribute("aria-label", `${rule.enabled ? "停用" : "啟用"}「${rule.from}」替換`);
      const visual = document.createElement("span");
      visual.setAttribute("aria-hidden", "true");
      input.addEventListener("change", () => updateReplacement(index, { enabled: input.checked }));
      toggle.append(input, visual);
      const words = document.createElement("span");
      words.className = "replacement-words";
      words.textContent = `${rule.from} → ${rule.to}`;
      words.title = words.textContent;
      const actions = document.createElement("div");
      actions.className = "replacement-actions";
      const up = document.createElement("button");
      up.type = "button";
      up.textContent = "↑";
      up.title = "提高優先順序";
      up.disabled = !localMode || index === 0;
      up.addEventListener("click", () => moveReplacement(index, index - 1));
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.title = "降低優先順序";
      down.disabled = !localMode || index === settings.customReplacements.length - 1;
      down.addEventListener("click", () => moveReplacement(index, index + 1));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "replacement-delete";
      remove.textContent = "刪除";
      remove.disabled = !localMode;
      remove.addEventListener("click", () => removeReplacement(index));
      actions.append(up, down, remove);
      item.append(toggle, words, actions);
      replacementList.append(item);
    });
  }

  function setReplacementRules(rules) {
    settings = Core.mergeSettings({ ...settings, customReplacements: rules });
    renderReplacements();
    save();
  }

  function updateReplacement(index, patch) {
    const next = settings.customReplacements.map((rule, current) => current === index ? { ...rule, ...patch } : rule);
    setReplacementRules(next);
  }

  function moveReplacement(from, to) {
    if (to < 0 || to >= settings.customReplacements.length) return;
    const next = [...settings.customReplacements];
    [next[from], next[to]] = [next[to], next[from]];
    setReplacementRules(next);
  }

  function removeReplacement(index) {
    setReplacementRules(settings.customReplacements.filter((_, current) => current !== index));
  }

  function renderCurrentChannel() {
    const channelId = String(currentStatus?.channelId || "");
    const channelName = String(currentStatus?.channelName || "");
    if (!channelId) {
      currentChannelName.textContent = "目前頁面不是可辨識的 YouTube 影片";
      currentChannelId.textContent = "";
      addCurrentChannel.disabled = true;
      addCurrentChannel.textContent = "將目前頻道加入規則";
      return;
    }
    const exists = settings.channelRules.some((rule) => rule.channelId === channelId);
    const reachedLimit = settings.channelRules.length >= Core.MAX_CHANNEL_RULES;
    currentChannelName.textContent = channelName || "未命名頻道";
    currentChannelId.textContent = channelId;
    addCurrentChannel.disabled = exists || reachedLimit;
    addCurrentChannel.textContent = exists
      ? "目前頻道已加入"
      : reachedLimit
        ? `已達 ${Core.MAX_CHANNEL_RULES} 條上限`
        : "將目前頻道加入規則";
  }

  function renderChannelRules() {
    channelRuleList.replaceChildren();
    settings.channelRules.forEach((rule) => {
      const item = document.createElement("li");
      item.className = "channel-rule-item";
      const identity = document.createElement("div");
      identity.className = "channel-rule-name";
      const name = document.createElement("strong");
      name.textContent = rule.channelName;
      const id = document.createElement("small");
      id.textContent = rule.channelId;
      identity.append(name, id);

      const select = document.createElement("select");
      select.className = "channel-rule-select";
      select.setAttribute("aria-label", `選擇「${rule.channelName}」的頻道規則`);
      for (const mode of Core.CHANNEL_RULE_MODES) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent = CHANNEL_MODE_LABELS[mode];
        option.selected = rule.mode === mode;
        select.append(option);
      }
      select.addEventListener("change", () => updateChannelRule(rule.channelId, { mode: select.value }));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "channel-rule-delete";
      remove.textContent = "刪除";
      remove.setAttribute("aria-label", `刪除「${rule.channelName}」的頻道規則`);
      remove.addEventListener("click", () => removeChannelRule(rule.channelId));
      item.append(identity, select, remove);
      channelRuleList.append(item);
    });
  }

  function setChannelRules(rules) {
    settings = Core.mergeSettings({ ...settings, channelRules: rules });
    if (currentStatus?.channelId) {
      currentStatus.channelRuleMode = settings.channelRules
        .find((rule) => rule.channelId === currentStatus.channelId)?.mode || "";
    }
    renderChannelRules();
    renderCurrentChannel();
    save();
  }

  function updateChannelRule(channelId, patch) {
    setChannelRules(settings.channelRules.map((rule) => (
      rule.channelId === channelId ? { ...rule, ...patch } : rule
    )));
  }

  function removeChannelRule(channelId) {
    setChannelRules(settings.channelRules.filter((rule) => rule.channelId !== channelId));
  }

  async function save() {
    const { customReplacements, channelRules, ...syncSettings } = settings;
    await Promise.all([
      chrome.storage.sync.set({ settings: syncSettings }),
      chrome.storage.local.set({ customReplacements, channelRules })
    ]);
    saveStatus.textContent = "已儲存";
    const response = await sendToTab({ type: "ytlang:settings-updated", settings });
    if (response?.status) renderStatus(response.status);
    window.setTimeout(() => { saveStatus.textContent = "設定會自動儲存"; }, 1300);
  }

  function move(from, to) {
    if (to < 0 || to >= settings.priority.length) return;
    const next = [...settings.priority];
    [next[from], next[to]] = [next[to], next[from]];
    settings = Core.mergeSettings({ ...settings, priority: next });
    renderPriority();
    save();
  }

  function toggleRule(id, shouldEnable) {
    const disabledRules = new Set(settings.disabledRules);
    if (shouldEnable) disabledRules.delete(id);
    else disabledRules.add(id);
    settings = Core.mergeSettings({ ...settings, disabledRules: [...disabledRules] });
    renderPriority();
    save();
  }

  function renderStatus(status) {
    currentStatus = status || null;
    renderCurrentChannel();
    if (!status?.videoId) return;
    const planLabels = {
      native: "原生字幕",
      opencc: "簡體 → 台灣繁體",
      translate: "自動翻譯 → 繁體中文",
      toggle: "已開啟 YouTube 可用字幕",
      "channel-disabled": "此頻道已停用自動功能",
      "channel-force-enable": "頻道規則：強置開啟字幕",
      "channel-force-disable": "頻道規則：強置關閉字幕",
      none: "找不到可用字幕"
    };
    routeStatus.textContent = status.sourceName || planLabels[status.planType] || "字幕規則已就緒";
    routeDetail.textContent = planLabels[status.planType] || "等待套用";
    if (status.targetName) routeDetail.textContent += ` · ${status.targetName}`;
    if (status.detectionSkipReason === "channel-disabled") {
      detectorStatus.textContent = "頻道規則 · 已停用全部自動功能";
    } else if (status.detectionSkipReason === "channel-force-enable-no-ocr") {
      detectorStatus.textContent = "頻道規則 · 強置開啟字幕，不進行 OCR";
    } else if (status.detectionSkipReason === "channel-force-disable-no-ocr") {
      detectorStatus.textContent = "頻道規則 · 強置關閉字幕，不進行 OCR";
    } else if (status.detectionSkipReason === "no-caption-tracks") {
      detectorStatus.textContent = "已略過 · 影片沒有任何 CC 字幕";
    } else if (status.detectionSkipReason === "channel-skip-ocr") {
      detectorStatus.textContent = "頻道規則 · 已略過 OCR 字幕辨識";
    } else if (status.detectionSkipReason === "simplified-only") {
      detectorStatus.textContent = "已略過 · 只有簡體 CC、沒有繁體字幕";
    } else if (status.embeddedDetected) {
      detectorStatus.textContent = "已判定有內嵌字幕，CC 已關閉";
    } else if (status.detectionComplete) {
      detectorStatus.textContent = `取樣完成 · ${status.detectionSamples || 0} 段 · 未判定有內嵌字幕`;
    } else if (status.detectionSamples) {
      const score = Number.isFinite(status.lastDetectionScore) ? ` · 最近分數 ${status.lastDetectionScore}` : "";
      const band = Number.isFinite(status.lastDetectionBand) ? ` · 底部區域 ${status.lastDetectionBand}%` : "";
      detectorStatus.textContent = `正在判斷 · 已取樣 ${status.detectionSamples}/6 段${score}${band}`;
    } else if (settings.embeddedDetection && status.captureError === "tab-not-active") {
      detectorStatus.textContent = "切回此影片分頁後會自動繼續取樣";
    } else if (settings.embeddedDetection && status.captureError) {
      detectorStatus.textContent = "目前無法擷取畫面，會在下一段有效字幕自動重試";
    } else if (settings.embeddedDetection) {
      detectorStatus.textContent = "已就緒，等待有效 CC 字幕";
    }
  }

  enabled.addEventListener("change", async () => {
    settings = Core.mergeSettings({ ...settings, enabled: enabled.checked });
    await updateToolbarState(settings.enabled);
    await save();
  });

  embeddedDetection.addEventListener("change", async () => {
    settings = Core.mergeSettings({ ...settings, embeddedDetection: embeddedDetection.checked });
    await save();
  });

  skipEmbeddedDetectionForSimplifiedOnly.addEventListener("change", async () => {
    settings = Core.mergeSettings({
      ...settings,
      skipEmbeddedDetectionForSimplifiedOnly: skipEmbeddedDetectionForSimplifiedOnly.checked
    });
    await save();
  });

  taiwanTermsEnabled.addEventListener("change", () => {
    settings = Core.mergeSettings({ ...settings, taiwanTermsEnabled: taiwanTermsEnabled.checked });
    save();
  });

  hongKongColloquialEnabled.addEventListener("change", () => {
    settings = Core.mergeSettings({ ...settings, hongKongColloquialEnabled: hongKongColloquialEnabled.checked });
    save();
  });

  customReplacementsEnabled.addEventListener("change", () => {
    settings = Core.mergeSettings({ ...settings, customReplacementsEnabled: customReplacementsEnabled.checked });
    save();
  });

  addCurrentChannel.addEventListener("click", () => {
    const channelId = String(currentStatus?.channelId || "");
    if (!channelId
      || settings.channelRules.length >= Core.MAX_CHANNEL_RULES
      || settings.channelRules.some((rule) => rule.channelId === channelId)) return;
    setChannelRules([...settings.channelRules, {
      channelId,
      channelName: String(currentStatus?.channelName || "").trim() || "未命名頻道",
      mode: "skip-ocr"
    }]);
  });

  replacementForm.addEventListener("submit", (event) => {
    event.preventDefault();
    replacementError.textContent = "";
    const from = replacementFrom.value.trim();
    const to = replacementTo.value.trim();
    if (!from || !to) {
      replacementError.textContent = "請同時輸入原詞與新詞。";
      return;
    }
    if (from === to) {
      replacementError.textContent = "原詞與新詞不能相同。";
      return;
    }
    if (settings.customReplacements.some((rule) => rule.from === from)) {
      replacementError.textContent = "這個原詞已經有替換規則。";
      return;
    }
    if (settings.customReplacements.length >= Core.MAX_CUSTOM_REPLACEMENTS) {
      replacementError.textContent = `自訂規則最多 ${Core.MAX_CUSTOM_REPLACEMENTS} 條。`;
      return;
    }
    setReplacementRules([...settings.customReplacements, { from, to, enabled: true }]);
    replacementForm.reset();
    replacementFrom.focus();
  });

  for (const radio of document.querySelectorAll('input[name="simplifiedMode"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      settings = Core.mergeSettings({ ...settings, simplifiedMode: radio.value });
      renderSettings();
      save();
    });
  }

  document.getElementById("reapply").addEventListener("click", async () => {
    await sendToTab({ type: "ytlang:reapply" });
    saveStatus.textContent = "已重新套用";
  });

  async function start() {
    const [stored, tab, local] = await Promise.all([
      getSync("settings"),
      queryActiveTab(),
      getLocal(["status", "customReplacements", "channelRules"])
    ]);
    settings = Core.migrateStoredSettings({
      ...stored.settings,
      customReplacements: local.customReplacements || stored.settings?.customReplacements,
      channelRules: local.channelRules || stored.settings?.channelRules
    });
    if (stored.settings?.settingsVersion !== settings.settingsVersion
      || stored.settings?.customReplacements
      || stored.settings?.channelRules) {
      const { customReplacements, channelRules, ...syncSettings } = settings;
      await Promise.all([
        chrome.storage.sync.set({ settings: syncSettings }),
        chrome.storage.local.set({ customReplacements, channelRules })
      ]);
    }
    activeTab = tab;
    const manifestVersion = chrome.runtime.getManifest?.().version;
    versionLabel.textContent = manifestVersion ? `v${manifestVersion}` : "";
    renderSettings();
    const response = await sendToTab({ type: "ytlang:get-status" });
    renderStatus(response?.status || local.status);
    await updateToolbarState(settings.enabled);
  }

  start();
})();
