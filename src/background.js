"use strict";

const ACTION_ICON_SIZES = [16, 32, 48, 128];

function actionIconPaths(enabled) {
  const state = enabled ? "enabled" : "disabled";
  return Object.fromEntries(ACTION_ICON_SIZES.map((size) => [size, `icons/${state}-${size}.png`]));
}

async function updateActionState(enabled) {
  await Promise.all([
    chrome.action.setIcon({ path: actionIconPaths(enabled) }),
    chrome.action.setTitle({ title: `Youtube 字幕全自動開關：${enabled ? "已開啟" : "已關閉"}` }),
    chrome.action.setBadgeText({ text: enabled ? "" : "OFF" }),
    chrome.action.setBadgeBackgroundColor({ color: "#7A8288" })
  ]);
}

async function syncActionState() {
  const result = await chrome.storage.sync.get("settings");
  await updateActionState(result.settings?.enabled !== false);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) return;
  updateActionState(changes.settings.newValue?.enabled !== false);
});

chrome.runtime.onInstalled.addListener(syncActionState);
chrome.runtime.onStartup.addListener(syncActionState);
syncActionState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ytlang:update-action-state") {
    updateActionState(message.enabled !== false)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:load-opencc") {
    const tabId = sender.tab?.id;
    const frameId = sender.frameId || 0;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, reason: "tab-unavailable" });
      return false;
    }
    chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      files: ["vendor/opencc.js"]
    }).then(() => chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: () => Boolean(globalThis.OpenCC?.Converter)
    })).then((results) => {
      const loaded = results.some((result) => result.result === true);
      sendResponse({ ok: loaded, reason: loaded ? "" : "opencc-unavailable" });
    }).catch((error) => sendResponse({ ok: false, reason: "opencc-load-failed", message: error.message }));
    return true;
  }

  if (message?.type !== "ytlang:capture-frame") return false;

  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, reason: "capture-unavailable" });
    return false;
  }

  Promise.resolve()
    .then(async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: sender.tab.windowId });
      if (activeTab?.id !== tabId) {
        sendResponse({ ok: false, reason: "tab-not-active" });
        return null;
      }
      return chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }));
    })
    .catch((error) => sendResponse({ ok: false, reason: "capture-failed", message: error.message }));
  return true;
});
