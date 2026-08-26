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
  const vipAccount = document.getElementById("vip-account");
  const vipAccountTitle = document.getElementById("vip-account-title");
  const vipAccountDetail = document.getElementById("vip-account-detail");
  const vipLogin = document.getElementById("vip-login");
  const vipManage = document.getElementById("vip-manage");
  const vipLogout = document.getElementById("vip-logout");
  const channelRulesSection = document.querySelector(".channel-rules-section");
  const cloudSyncSection = document.getElementById("cloud-sync-section");
  const cloudSyncEnabled = document.getElementById("cloud-sync-enabled");
  const cloudSyncStatus = document.getElementById("cloud-sync-status");
  const cloudSyncNow = document.getElementById("cloud-sync-now");
  const cloudSyncUseLocal = document.getElementById("cloud-sync-use-local");
  const cloudSyncUseCloud = document.getElementById("cloud-sync-use-cloud");
  const cloudSyncManage = document.getElementById("cloud-sync-manage");
  const CHANNEL_MODE_LABELS = Object.freeze({
    disabled: "停用全部功能",
    "force-enable-no-ocr": "強制開啟字幕",
    "force-enable-convert": "強制開啟字幕 + 簡繁轉換",
    "force-enable-convert-hk": "強制開啟字幕 + 簡繁粵語轉換"
  });
  const ACTION_ICON_SIZES = [16, 32, 48, 128];
  const actionImageDataCache = new Map();
  let settings = Core.mergeSettings();
  let activeTab = null;
  let currentStatus = null;
  let vipEntitlement = { authenticated: false, vipActive: false, email: "", displayName: "" };
  let cloudSyncState = { enabled: false, revision: 0, pending: false, conflict: false, status: "disabled", lastError: "" };

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
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          resolve(error ? { ok: false, message: `插件背景程序無法回應：${error.message}` } : (response || null));
        });
      } catch (error) {
        resolve({ ok: false, message: `無法啟動登入流程：${error.message}` });
      }
    });
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

  function renderVipAccount() {
    const authenticated = vipEntitlement.authenticated === true;
    const active = vipEntitlement.vipActive === true;
    vipAccount.classList.toggle("is-active", active);
    vipAccountTitle.textContent = active
      ? "VIP 終身版已啟用"
      : authenticated
        ? "已登入，尚未購買 VIP"
        : "尚未登入";
    vipAccountDetail.textContent = authenticated
      ? (vipEntitlement.email || "Google 帳號已連接")
      : "登入購買時使用的 Google 帳號以驗證 VIP";
    vipLogin.textContent = active ? "VIP 已啟用" : authenticated ? "重新驗證" : "使用 Google 登入";
    vipLogin.disabled = active;
    vipLogout.hidden = !authenticated;
  }

  function renderCloudSync() {
    const vipActive = vipEntitlement.vipActive === true;
    cloudSyncSection.classList.toggle("is-vip-locked", !vipActive);
    cloudSyncSection.classList.toggle("is-conflict", cloudSyncState.conflict === true);
    cloudSyncSection.setAttribute("aria-disabled", String(!vipActive));
    cloudSyncEnabled.checked = vipActive && cloudSyncState.enabled === true;
    cloudSyncEnabled.disabled = !vipActive;
    cloudSyncNow.disabled = !vipActive || !cloudSyncState.enabled || cloudSyncState.status === "syncing";
    cloudSyncUseLocal.hidden = cloudSyncState.conflict !== true;
    cloudSyncUseCloud.hidden = cloudSyncState.conflict !== true;
    cloudSyncUseLocal.disabled = !vipActive;
    cloudSyncUseCloud.disabled = !vipActive;
    cloudSyncManage.disabled = !vipActive;

    if (!vipActive) cloudSyncStatus.textContent = "VIP 尚未啟用，雲端同步目前為關閉。";
    else if (!cloudSyncState.enabled) cloudSyncStatus.textContent = "預設只儲存在本機，尚未啟用雲端同步。";
    else if (cloudSyncState.conflict) cloudSyncStatus.textContent = cloudSyncState.lastError || "本機與網站資料不同，請選擇保留哪一份。";
    else if (cloudSyncState.status === "syncing") cloudSyncStatus.textContent = "正在安全同步自訂詞彙與頻道規則…";
    else if (cloudSyncState.status === "offline") cloudSyncStatus.textContent = cloudSyncState.lastError || "目前離線，本機功能不受影響。";
    else if (cloudSyncState.pending) cloudSyncStatus.textContent = "本機修改已保留，等待同步到網站。";
    else if (cloudSyncState.lastSyncedAt) cloudSyncStatus.textContent = `已同步 · ${new Date(cloudSyncState.lastSyncedAt).toLocaleString("zh-TW")}`;
    else cloudSyncStatus.textContent = "雲端同步已啟用。";
  }

  function applyCloudResult(response) {
    if (response?.state) cloudSyncState = { ...cloudSyncState, ...response.state };
    if (response?.data) {
      settings = Core.mergeSettings({
        ...settings,
        customReplacements: response.data.customReplacements,
        channelRules: response.data.channelRules
      });
      renderSettings();
    }
    renderCloudSync();
  }

  async function applyVipDefaultsIfNeeded() {
    if (vipEntitlement.vipActive !== true || Number(settings.vipDefaultsVersion || 0) >= 1) return;
    settings = Core.applyVipActivationDefaults(settings);
    renderSettings();
    await save();
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
    const localMode = settings.simplifiedMode === "opencc";
    const vipActive = vipEntitlement.vipActive === true;
    taiwanTermsEnabled.checked = settings.taiwanTermsEnabled && localMode && vipActive;
    hongKongColloquialEnabled.checked = settings.hongKongColloquialEnabled && localMode && vipActive;
    taiwanTermsEnabled.disabled = !localMode || !vipActive;
    hongKongColloquialEnabled.disabled = !localMode || !vipActive;
    termsSection.classList.toggle("is-locked", !localMode);
    termsSection.classList.toggle("is-vip-locked", !vipActive);
    termsSection.setAttribute("aria-disabled", String(!localMode || !vipActive));
    customReplacementsEnabled.checked = settings.customReplacementsEnabled && localMode && vipActive;
    customReplacementsEnabled.disabled = !localMode || !vipActive;
    customSection.classList.toggle("is-locked", !localMode);
    customSection.classList.toggle("is-vip-locked", !vipActive);
    customSection.setAttribute("aria-disabled", String(!localMode || !vipActive));
    for (const control of replacementForm.elements) control.disabled = !localMode || !vipActive;
    channelRulesSection.classList.toggle("is-vip-locked", !vipActive);
    channelRulesSection.setAttribute("aria-disabled", String(!vipActive));
    const radio = document.querySelector(`input[name="simplifiedMode"][value="${settings.simplifiedMode}"]`);
    if (radio) radio.checked = true;
    simplifiedHint.textContent = settings.simplifiedMode === "youtube"
      ? "由 YouTube 將簡體字幕自動翻譯為繁體中文，結果與時間切分由 YouTube 控制。"
      : "本機轉換不會送出字幕文字，並保留原始時間軸。";
    renderPriority();
    renderReplacements();
    renderChannelRules();
    renderCurrentChannel();
    renderCloudSync();
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
      input.disabled = !localMode || vipEntitlement.vipActive !== true;
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
      up.disabled = !localMode || vipEntitlement.vipActive !== true || index === 0;
      up.addEventListener("click", () => moveReplacement(index, index - 1));
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "↓";
      down.title = "降低優先順序";
      down.disabled = !localMode || vipEntitlement.vipActive !== true || index === settings.customReplacements.length - 1;
      down.addEventListener("click", () => moveReplacement(index, index + 1));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "replacement-delete";
      remove.textContent = "刪除";
      remove.disabled = !localMode || vipEntitlement.vipActive !== true;
      remove.addEventListener("click", () => removeReplacement(index));
      actions.append(up, down, remove);
      item.append(toggle, words, actions);
      replacementList.append(item);
    });
  }

  function setReplacementRules(rules) {
    settings = Core.mergeSettings({ ...settings, customReplacements: rules });
    renderReplacements();
    save({ cloudDataChanged: true });
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
    addCurrentChannel.disabled = vipEntitlement.vipActive !== true || exists || reachedLimit;
    addCurrentChannel.textContent = exists
      ? "目前頻道已加入"
      : vipEntitlement.vipActive !== true
        ? "VIP 登入後可加入"
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
      select.disabled = vipEntitlement.vipActive !== true;
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
      remove.disabled = vipEntitlement.vipActive !== true;
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
    save({ cloudDataChanged: true });
  }

  function updateChannelRule(channelId, patch) {
    setChannelRules(settings.channelRules.map((rule) => (
      rule.channelId === channelId ? { ...rule, ...patch } : rule
    )));
  }

  function removeChannelRule(channelId) {
    setChannelRules(settings.channelRules.filter((rule) => rule.channelId !== channelId));
  }

  async function save({ cloudDataChanged = false } = {}) {
    const { customReplacements, channelRules, ...syncSettings } = settings;
    await Promise.all([
      chrome.storage.sync.set({ settings: syncSettings }),
      chrome.storage.local.set({ customReplacements, channelRules })
    ]);
    saveStatus.textContent = "已儲存";
    const response = await sendToTab({ type: "ytlang:settings-updated", settings, vipActive: vipEntitlement.vipActive === true });
    if (response?.status) renderStatus(response.status);
    if (cloudDataChanged && cloudSyncState.enabled) {
      sendToRuntime({ type: "ytlang:cloud-sync-local-changed" }).then(applyCloudResult);
    }
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
      "channel-force-enable": "頻道規則：強制開啟字幕",
      none: "找不到可用字幕"
    };
    routeStatus.textContent = status.sourceName || planLabels[status.planType] || "字幕規則已就緒";
    routeDetail.textContent = planLabels[status.planType] || "等待套用";
    if (status.targetName) routeDetail.textContent += ` · ${status.targetName}`;
    if (status.detectionSkipReason === "channel-disabled") {
      detectorStatus.textContent = "頻道規則 · 已停用全部自動功能";
    } else if (status.detectionSkipReason === "channel-force-enable-no-ocr") {
      detectorStatus.textContent = "頻道規則 · 強制開啟 CC 字幕，不進行 OCR";
    } else if (status.detectionSkipReason === "channel-force-enable-convert-no-ocr") {
      detectorStatus.textContent = "頻道規則 · 強制開啟 CC 字幕並進行簡繁轉換";
    } else if (status.detectionSkipReason === "channel-force-enable-convert-hk-no-ocr") {
      detectorStatus.textContent = "頻道規則 · 強制開啟 CC 字幕並進行簡繁、粵語轉換";
    } else if (status.detectionSkipReason === "no-caption-tracks") {
      detectorStatus.textContent = "已略過 · 影片沒有任何 CC 字幕";
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
    if (vipEntitlement.vipActive !== true) return;
    settings = Core.mergeSettings({ ...settings, taiwanTermsEnabled: taiwanTermsEnabled.checked });
    save();
  });

  hongKongColloquialEnabled.addEventListener("change", () => {
    if (vipEntitlement.vipActive !== true) return;
    settings = Core.mergeSettings({ ...settings, hongKongColloquialEnabled: hongKongColloquialEnabled.checked });
    save();
  });

  customReplacementsEnabled.addEventListener("change", () => {
    if (vipEntitlement.vipActive !== true) return;
    settings = Core.mergeSettings({ ...settings, customReplacementsEnabled: customReplacementsEnabled.checked });
    save();
  });

  addCurrentChannel.addEventListener("click", () => {
    if (vipEntitlement.vipActive !== true) return;
    const channelId = String(currentStatus?.channelId || "");
    if (!channelId
      || settings.channelRules.length >= Core.MAX_CHANNEL_RULES
      || settings.channelRules.some((rule) => rule.channelId === channelId)) return;
    setChannelRules([...settings.channelRules, {
      channelId,
      channelName: String(currentStatus?.channelName || "").trim() || "未命名頻道",
      mode: "force-enable-no-ocr"
    }]);
  });

  replacementForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (vipEntitlement.vipActive !== true) return;
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

  vipLogin.addEventListener("click", async () => {
    if (vipEntitlement.vipActive === true) return;
    vipLogin.disabled = true;
    vipLogin.textContent = "正在開啟登入…";
    vipAccountDetail.textContent = "正在開啟 Google 登入視窗，請稍候…";
    const response = await sendToRuntime({ type: "ytlang:vip-login" });
    if (response?.entitlement) {
      vipEntitlement = response.entitlement;
      renderVipAccount();
      renderSettings();
      await applyVipDefaultsIfNeeded();
    } else {
      vipAccountDetail.textContent = response?.message || "登入流程沒有回應，請重新載入插件後再試一次。";
    }
    vipLogin.disabled = vipEntitlement.vipActive === true;
    if (!vipLogin.disabled) vipLogin.textContent = vipEntitlement.authenticated ? "重新驗證" : "使用 Google 登入";
  });

  vipManage.addEventListener("click", () => sendToRuntime({ type: "ytlang:vip-open-account" }));

  cloudSyncEnabled.addEventListener("change", async () => {
    if (vipEntitlement.vipActive !== true) return;
    cloudSyncEnabled.disabled = true;
    cloudSyncStatus.textContent = cloudSyncEnabled.checked ? "正在啟用雲端同步…" : "正在關閉雲端同步…";
    const response = await sendToRuntime({ type: "ytlang:cloud-sync-enable", enabled: cloudSyncEnabled.checked });
    if (!response?.ok) cloudSyncStatus.textContent = response?.message || "無法更新同步設定";
    applyCloudResult(response);
  });

  cloudSyncNow.addEventListener("click", async () => {
    cloudSyncStatus.textContent = "正在同步…";
    applyCloudResult(await sendToRuntime({ type: "ytlang:cloud-sync-now", mode: "auto" }));
  });

  cloudSyncUseLocal.addEventListener("click", async () => {
    cloudSyncStatus.textContent = "正在以本機資料更新網站…";
    applyCloudResult(await sendToRuntime({ type: "ytlang:cloud-sync-now", mode: "local" }));
  });

  cloudSyncUseCloud.addEventListener("click", async () => {
    cloudSyncStatus.textContent = "正在下載網站資料…";
    applyCloudResult(await sendToRuntime({ type: "ytlang:cloud-sync-now", mode: "cloud" }));
  });

  cloudSyncManage.addEventListener("click", () => sendToRuntime({ type: "ytlang:vip-open-account", section: "cloud" }));

  vipLogout.addEventListener("click", async () => {
    const response = await sendToRuntime({ type: "ytlang:vip-logout" });
    vipEntitlement = response?.entitlement || { authenticated: false, vipActive: false, email: "", displayName: "" };
    renderVipAccount();
    renderSettings();
  });

  async function start() {
    const [stored, tab, local] = await Promise.all([
      getSync("settings"),
      queryActiveTab(),
      getLocal(["status", "customReplacements", "channelRules", "vipEntitlement", "vipAuthNotice", "cloudSyncState"])
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
    vipEntitlement = local.vipEntitlement || vipEntitlement;
    cloudSyncState = { ...cloudSyncState, ...(local.cloudSyncState || {}) };
    const manifestVersion = chrome.runtime.getManifest?.().version;
    versionLabel.textContent = manifestVersion ? `v${manifestVersion}` : "";
    renderVipAccount();
    if (local.vipAuthNotice?.message && Date.now() - Number(local.vipAuthNotice.createdAt || 0) < 10 * 60 * 1000) {
      vipAccountDetail.textContent = local.vipAuthNotice.message;
    }
    renderSettings();
    const response = await sendToTab({ type: "ytlang:get-status" });
    renderStatus(response?.status || local.status);
    await updateToolbarState(settings.enabled);
    const vipResponse = await sendToRuntime({ type: "ytlang:vip-get-status", force: true });
    if (vipResponse?.entitlement) {
      vipEntitlement = vipResponse.entitlement;
      renderVipAccount();
      renderSettings();
      await applyVipDefaultsIfNeeded();
      const cloudResponse = await sendToRuntime({ type: "ytlang:cloud-sync-now", mode: "auto" });
      if (cloudResponse?.ok) applyCloudResult(cloudResponse);
    }
  }

  start();
})();
