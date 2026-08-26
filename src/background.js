"use strict";

const ACTION_ICON_SIZES = [16, 32, 48, 128];
const VIP_SITE = "https://myapp.ahui3c.com";
const VIP_AUTH_STATUS_URL = `${VIP_SITE}/api/auth/status`;
const VIP_ACCOUNT_SETUP_URL = `${VIP_SITE}/account?source=extension&error=google_not_configured`;
const CLOUD_SYNC_URL = `${VIP_SITE}/api/extension/sync`;
const MAX_CUSTOM_REPLACEMENTS = 100;
const MAX_CHANNEL_RULES = 50;
const CHANNEL_RULE_MODES = new Set([
  "disabled",
  "force-enable-no-ocr",
  "force-enable-convert",
  "force-enable-convert-hk"
]);

function localGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function syncGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

function normalizeCustomReplacements(rules) {
  if (!Array.isArray(rules)) return [];
  const result = [];
  const seen = new Set();
  for (const candidate of rules) {
    const from = String(candidate?.from || "").trim().slice(0, 80);
    const to = String(candidate?.to || "").trim().slice(0, 80);
    if (!from || !to || from === to || seen.has(from)) continue;
    seen.add(from);
    result.push({ from, to, enabled: candidate?.enabled !== false });
    if (result.length >= MAX_CUSTOM_REPLACEMENTS) break;
  }
  return result;
}

function normalizeChannelRules(rules) {
  if (!Array.isArray(rules)) return [];
  const result = [];
  const seen = new Set();
  for (const candidate of rules) {
    const channelId = String(candidate?.channelId || "").trim().slice(0, 100);
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);
    const channelName = String(candidate?.channelName || "").trim().slice(0, 100) || "未命名頻道";
    const mode = CHANNEL_RULE_MODES.has(String(candidate?.mode || ""))
      ? String(candidate.mode)
      : "force-enable-no-ocr";
    result.push({ channelId, channelName, mode });
    if (result.length >= MAX_CHANNEL_RULES) break;
  }
  return result;
}

function normalizeCloudData(data) {
  return {
    customReplacements: normalizeCustomReplacements(data?.customReplacements),
    channelRules: normalizeChannelRules(data?.channelRules)
  };
}

function cloudDataEqual(left, right) {
  return JSON.stringify(normalizeCloudData(left)) === JSON.stringify(normalizeCloudData(right));
}

async function initializeVipDefaults() {
  const stored = await syncGet("settings");
  const current = stored.settings && typeof stored.settings === "object" ? stored.settings : {};
  if (Number(current.vipDefaultsVersion || 0) >= 1) return current;
  const next = {
    ...current,
    taiwanTermsEnabled: true,
    hongKongColloquialEnabled: false,
    customReplacementsEnabled: true,
    vipDefaultsVersion: 1
  };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

async function notifyVipStatus(entitlement) {
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" }).catch(() => []);
  await Promise.allSettled(tabs.map((tab) => Number.isInteger(tab.id)
    ? chrome.tabs.sendMessage(tab.id, { type: "ytlang:vip-status-updated", entitlement })
    : Promise.resolve()));
}

async function storeVipEntitlement(entitlement) {
  const value = {
    authenticated: entitlement?.authenticated === true,
    vipActive: entitlement?.vipActive === true,
    email: String(entitlement?.email || entitlement?.account?.email || ""),
    displayName: String(entitlement?.displayName || entitlement?.account?.displayName || ""),
    plan: String(entitlement?.plan || ""),
    checkedAt: entitlement?.checkedAt || new Date().toISOString()
  };
  const current = (await localGet("vipEntitlement")).vipEntitlement;
  const changed = !current
    || current.authenticated !== value.authenticated
    || current.vipActive !== value.vipActive
    || current.email !== value.email
    || current.displayName !== value.displayName
    || current.plan !== value.plan;
  if (changed || current.checkedAt !== value.checkedAt) await chrome.storage.local.set({ vipEntitlement: value });
  if (value.vipActive) await initializeVipDefaults();
  if (current?.authenticated && (!value.authenticated || (current.email && value.email && current.email !== value.email))) {
    await storeCloudSyncState({
      enabled: false, revision: 0, pending: false, conflict: false,
      accountEmail: "", status: "disabled", lastError: "帳號已變更，請重新選擇是否啟用同步"
    });
  }
  if (changed) await notifyVipStatus(value);
  return value;
}

async function refreshVipEntitlement(force = false) {
  const stored = await localGet(["vipAccessToken", "vipEntitlement"]);
  if (!stored.vipAccessToken) {
    if (stored.vipEntitlement?.authenticated === false && stored.vipEntitlement?.vipActive === false) return stored.vipEntitlement;
    return storeVipEntitlement({ authenticated: false, vipActive: false });
  }
  const checkedAt = Date.parse(stored.vipEntitlement?.checkedAt || "");
  if (!force && Number.isFinite(checkedAt) && Date.now() - checkedAt < 15 * 60 * 1000) return stored.vipEntitlement;
  try {
    const response = await fetch(`${VIP_SITE}/api/extension/entitlement`, {
      headers: { authorization: `Bearer ${stored.vipAccessToken}` },
      cache: "no-store"
    });
    if (!response.ok) {
      if (response.status === 401) await chrome.storage.local.remove("vipAccessToken");
      return storeVipEntitlement({ authenticated: false, vipActive: false });
    }
    return storeVipEntitlement(await response.json());
  } catch {
    return stored.vipEntitlement || { authenticated: true, vipActive: false, checkedAt: "" };
  }
}

function launchWebAuthFlow(url) {
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.launchWebAuthFlow({ url, interactive: true }, (redirectUrl) => {
        const error = chrome.runtime.lastError;
        if (error || !redirectUrl) reject(new Error(error?.message || "Google 登入未完成"));
        else resolve(redirectUrl);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function checkGoogleAuthReady() {
  try {
    const response = await fetch(VIP_AUTH_STATUS_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const status = await response.json();
    return status.googleReady === true;
  } catch {
    return null;
  }
}

async function storeVipAuthNotice(message) {
  await chrome.storage.local.set({
    vipAuthNotice: { message: String(message || "Google 登入未完成"), createdAt: Date.now() }
  });
}

async function connectVipAccount() {
  const googleReady = await checkGoogleAuthReady();
  if (googleReady === false) {
    const message = "Google 登入服務尚未完成設定，已開啟會員中心說明。";
    await storeVipAuthNotice(message);
    await chrome.tabs.create({ url: VIP_ACCOUNT_SETUP_URL });
    throw new Error(message);
  }
  const redirectUri = chrome.identity.getRedirectURL("vip");
  const authorizeUrl = `${VIP_SITE}/extension/connect?redirect_uri=${encodeURIComponent(redirectUri)}`;
  const callbackUrl = new URL(await launchWebAuthFlow(authorizeUrl));
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("網站沒有回傳插件授權碼");
  const response = await fetch(`${VIP_SITE}/api/extension/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirectUri })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.accessToken) throw new Error("無法完成插件授權");
  await chrome.storage.local.set({ vipAccessToken: result.accessToken });
  await chrome.storage.local.remove("vipAuthNotice");
  return storeVipEntitlement({
    authenticated: true,
    vipActive: result.account?.vipActive === true,
    email: result.account?.email,
    displayName: result.account?.displayName,
    checkedAt: new Date().toISOString()
  });
}

async function disconnectVipAccount() {
  const stored = await localGet("vipAccessToken");
  if (stored.vipAccessToken) {
    await fetch(`${VIP_SITE}/api/extension/entitlement`, {
      method: "POST",
      headers: { authorization: `Bearer ${stored.vipAccessToken}` }
    }).catch(() => null);
  }
  await chrome.storage.local.remove("vipAccessToken");
  return storeVipEntitlement({ authenticated: false, vipActive: false });
}

function defaultCloudSyncState() {
  return {
    enabled: false,
    revision: 0,
    pending: false,
    conflict: false,
    status: "disabled",
    lastSyncedAt: "",
    lastError: "",
    accountEmail: ""
  };
}

async function getCloudSyncState() {
  const stored = await localGet("cloudSyncState");
  return { ...defaultCloudSyncState(), ...(stored.cloudSyncState || {}) };
}

async function storeCloudSyncState(patch) {
  const current = await getCloudSyncState();
  const next = { ...current, ...patch };
  if (JSON.stringify(current) !== JSON.stringify(next)) {
    await chrome.storage.local.set({ cloudSyncState: next });
  }
  return next;
}

async function getLocalCloudData() {
  const stored = await localGet(["customReplacements", "channelRules"]);
  return normalizeCloudData(stored);
}

async function notifyCloudDataChanged(data) {
  const synced = await syncGet("settings");
  const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" }).catch(() => []);
  await Promise.allSettled(tabs.map((tab) => Number.isInteger(tab.id)
    ? chrome.tabs.sendMessage(tab.id, {
      type: "ytlang:settings-updated",
      settings: { ...(synced.settings || {}), ...data },
      vipActive: true
    })
    : Promise.resolve()));
}

async function storeLocalCloudData(data) {
  const normalized = normalizeCloudData(data);
  const current = await getLocalCloudData();
  if (!cloudDataEqual(current, normalized)) {
    await chrome.storage.local.set(normalized);
    await notifyCloudDataChanged(normalized);
  }
  return normalized;
}

async function cloudSyncRequest(method, body) {
  const stored = await localGet(["vipAccessToken", "vipEntitlement"]);
  if (!stored.vipAccessToken || stored.vipEntitlement?.vipActive !== true) {
    const error = new Error("需要有效的 VIP 登入才能同步");
    error.code = "vip_required";
    throw error;
  }
  const response = await fetch(CLOUD_SYNC_URL, {
    method,
    headers: {
      authorization: `Bearer ${stored.vipAccessToken}`,
      ...(body ? { "content-type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.message || (response.status === 409 ? "雲端資料已有較新版本" : "雲端同步失敗"));
    error.code = response.status === 409 ? "conflict" : response.status === 401 ? "unauthorized" : "request_failed";
    error.current = result.current;
    throw error;
  }
  return result;
}

let cloudSyncPromise = null;

async function performCloudSync(mode = "auto") {
  const state = await getCloudSyncState();
  if (!state.enabled) return { state, data: await getLocalCloudData() };
  const entitlement = (await localGet("vipEntitlement")).vipEntitlement;
  if (entitlement?.vipActive !== true) {
    const locked = await storeCloudSyncState({ status: "locked", lastError: "VIP 尚未啟用" });
    return { state: locked, data: await getLocalCloudData() };
  }
  if (state.accountEmail && entitlement.email && state.accountEmail !== entitlement.email) {
    const changedAccount = await storeCloudSyncState({
      enabled: false, revision: 0, pending: false, conflict: false,
      accountEmail: "", status: "disabled", lastError: "Google 帳號已變更，請重新啟用同步"
    });
    return { state: changedAccount, data: await getLocalCloudData() };
  }

  await storeCloudSyncState({ status: "syncing", lastError: "" });
  try {
    const remote = await cloudSyncRequest("GET");
    const localData = await getLocalCloudData();
    const remoteData = normalizeCloudData(remote);

    if (mode === "cloud") {
      const data = await storeLocalCloudData(remoteData);
      const next = await storeCloudSyncState({
        revision: Number(remote.revision || 0), pending: false, conflict: false,
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: ""
      });
      return { state: next, data };
    }

    if (mode === "local") {
      const saved = await cloudSyncRequest("PUT", {
        baseRevision: Number(remote.revision || 0),
        ...localData
      });
      const next = await storeCloudSyncState({
        revision: Number(saved.revision || 0), pending: false, conflict: false,
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: ""
      });
      return { state: next, data: localData };
    }

    if (state.pending) {
      const saved = await cloudSyncRequest("PUT", {
        baseRevision: Number(state.revision || 0),
        ...localData
      });
      const next = await storeCloudSyncState({
        revision: Number(saved.revision || 0), pending: false, conflict: false,
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: ""
      });
      return { state: next, data: localData };
    }

    if (Number(remote.revision || 0) > Number(state.revision || 0)) {
      const data = await storeLocalCloudData(remoteData);
      const next = await storeCloudSyncState({
        revision: Number(remote.revision || 0), pending: false, conflict: false,
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: ""
      });
      return { state: next, data };
    }

    const next = await storeCloudSyncState({
      revision: Number(remote.revision || state.revision || 0), conflict: false,
      status: "synced", lastSyncedAt: new Date().toISOString(), lastError: ""
    });
    return { state: next, data: localData };
  } catch (error) {
    if (error.code === "conflict") {
      const next = await storeCloudSyncState({
        conflict: true, status: "conflict", lastError: "本機與網站都有新修改，請選擇要保留哪一份"
      });
      return { state: next, data: await getLocalCloudData() };
    }
    const next = await storeCloudSyncState({
      status: "offline", lastError: "目前無法連接同步服務，本機設定會繼續正常使用"
    });
    return { state: next, data: await getLocalCloudData() };
  }
}

function syncCloudData(mode = "auto") {
  if (cloudSyncPromise) return cloudSyncPromise;
  cloudSyncPromise = performCloudSync(mode).finally(() => { cloudSyncPromise = null; });
  return cloudSyncPromise;
}

async function setCloudSyncEnabled(enabled) {
  if (!enabled) {
    const state = await storeCloudSyncState({
      enabled: false, pending: false, conflict: false, status: "disabled", lastError: ""
    });
    return { state, data: await getLocalCloudData() };
  }
  const entitlement = (await localGet("vipEntitlement")).vipEntitlement;
  if (entitlement?.vipActive !== true) {
    return { state: await storeCloudSyncState({ enabled: false, status: "locked", lastError: "VIP 尚未啟用" }) };
  }
  const localData = await getLocalCloudData();
  const hasLocalData = localData.customReplacements.length > 0 || localData.channelRules.length > 0;
  await storeCloudSyncState({
    enabled: true, pending: hasLocalData, conflict: false, status: "syncing", lastError: "",
    accountEmail: String(entitlement.email || "")
  });
  return syncCloudData("auto");
}

async function markCloudDataChanged() {
  const state = await getCloudSyncState();
  if (!state.enabled) return { state, data: await getLocalCloudData() };
  await storeCloudSyncState({ pending: true, status: "pending", lastError: "" });
  return syncCloudData("auto");
}

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

chrome.runtime.onInstalled.addListener(() => {
  syncActionState();
  refreshVipEntitlement().then(() => syncCloudData("auto")).catch(() => null);
});
chrome.runtime.onStartup.addListener(() => {
  syncActionState();
  refreshVipEntitlement().then(() => syncCloudData("auto")).catch(() => null);
});
syncActionState();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ytlang:vip-get-status") {
    refreshVipEntitlement(message.force === true)
      .then((entitlement) => sendResponse({ ok: true, entitlement }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:vip-login") {
    connectVipAccount()
      .then((entitlement) => sendResponse({ ok: true, entitlement }))
      .catch(async (error) => {
        await storeVipAuthNotice(error.message).catch(() => null);
        sendResponse({ ok: false, message: error.message });
      });
    return true;
  }

  if (message?.type === "ytlang:vip-logout") {
    disconnectVipAccount()
      .then((entitlement) => sendResponse({ ok: true, entitlement }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:vip-open-account") {
    chrome.tabs.create({ url: message.section === "cloud" ? `${VIP_SITE}/account#cloud-data` : `${VIP_SITE}/account` });
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "ytlang:cloud-sync-status") {
    Promise.all([getCloudSyncState(), getLocalCloudData()])
      .then(([state, data]) => sendResponse({ ok: true, state, data }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:cloud-sync-enable") {
    setCloudSyncEnabled(message.enabled === true)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:cloud-sync-local-changed") {
    markCloudDataChanged()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:cloud-sync-now") {
    syncCloudData(String(message.mode || "auto"))
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

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
