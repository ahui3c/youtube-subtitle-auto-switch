(function initPopup() {
  "use strict";

  const Core = globalThis.YTLangCore;
  const enabled = document.getElementById("enabled");
  const embeddedDetection = document.getElementById("embeddedDetection");
  const priorityList = document.getElementById("priority-list");
  const saveStatus = document.getElementById("save-status");
  const routeStatus = document.getElementById("route-status");
  const routeDetail = document.getElementById("route-detail");
  const detectorStatus = document.getElementById("detector-status");
  const simplifiedHint = document.getElementById("simplified-hint");
  const trackCount = document.getElementById("track-count");
  let settings = Core.mergeSettings();
  let activeTab = null;

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
    const radio = document.querySelector(`input[name="simplifiedMode"][value="${settings.simplifiedMode}"]`);
    if (radio) radio.checked = true;
    simplifiedHint.textContent = settings.simplifiedMode === "youtube"
      ? "由 YouTube 將簡體字幕自動翻譯為繁體中文，結果與時間切分由 YouTube 控制。"
      : "本機轉換不會送出字幕文字，並保留原始時間軸。";
    renderPriority();
  }

  async function save() {
    await chrome.storage.sync.set({ settings });
    saveStatus.textContent = "已儲存";
    await sendToTab({ type: "ytlang:settings-updated", settings });
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
    if (!status?.videoId) return;
    const planLabels = {
      native: "原生字幕",
      opencc: "簡體 → 台灣繁體",
      translate: "自動翻譯 → 繁體中文",
      none: "找不到可用字幕"
    };
    routeStatus.textContent = status.sourceName || planLabels[status.planType] || "字幕規則已就緒";
    routeDetail.textContent = planLabels[status.planType] || "等待套用";
    if (status.targetName) routeDetail.textContent += ` · ${status.targetName}`;
    if (status.embeddedDetected) {
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

  enabled.addEventListener("change", () => {
    settings = Core.mergeSettings({ ...settings, enabled: enabled.checked });
    save();
  });

  embeddedDetection.addEventListener("change", async () => {
    settings = Core.mergeSettings({ ...settings, embeddedDetection: embeddedDetection.checked });
    await save();
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
    const [stored, tab, local] = await Promise.all([getSync("settings"), queryActiveTab(), getLocal("status")]);
    settings = Core.migrateStoredSettings(stored.settings);
    if (stored.settings?.settingsVersion !== settings.settingsVersion) {
      await chrome.storage.sync.set({ settings });
    }
    activeTab = tab;
    renderSettings();
    renderStatus(local.status);
  }

  start();
})();
