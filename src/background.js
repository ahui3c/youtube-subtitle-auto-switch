"use strict";

if (typeof importScripts === "function") {
  try { importScripts("build-info.js"); } catch {}
  try { importScripts("instance-coordinator.js"); } catch {}
  try { importScripts("platform.js"); } catch {}
}
const InstanceCoordinator = globalThis.YTLangInstanceCoordinator || null;
const Platform = globalThis.YTLangPlatform || {
  api: globalThis.chrome || globalThis.browser,
  target: "chrome",
  isEdge: false,
  isFirefox: false,
  isSafari: false,
  capabilities: {
    embeddedSubtitleDetection: { available: typeof globalThis.chrome?.tabs?.captureVisibleTab === "function", experimental: false },
    extensionIdentity: { available: typeof globalThis.chrome?.identity?.launchWebAuthFlow === "function" }
  }
};
const CLIENT_PLATFORM = ["chrome", "edge", "firefox", "safari-macos"].includes(Platform.target)
  ? Platform.target
  : "unknown";

const ACTION_ICON_SIZES = [16, 32, 48, 128];
const VIP_SITE = "https://myapp.ahui3c.com";
const VIP_AUTH_STATUS_URL = `${VIP_SITE}/api/auth/status`;
const VIP_ACCOUNT_SETUP_URL = `${VIP_SITE}/account?source=extension&platform=${encodeURIComponent(CLIENT_PLATFORM)}&error=google_not_configured`;
const CLOUD_SYNC_URL = `${VIP_SITE}/api/extension/sync`;
const MAX_CUSTOM_REPLACEMENTS = 100;
const MAX_CHANNEL_RULES = 50;
const VIP_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const VIP_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const VIP_RETRY_BASE_MS = 60 * 1000;
const VIP_RETRY_MAX_MS = 60 * 60 * 1000;
const OWN_INSTANCE = Object.freeze({
  extensionId: String(globalThis.chrome?.runtime?.id || ""),
  version: String(globalThis.chrome?.runtime?.getManifest?.().version || "0.0.0"),
  distribution: InstanceCoordinator?.classifyDistribution(
    globalThis.chrome?.runtime?.id,
    globalThis.YTLangBuildInfo?.distribution
  ) || "unknown"
});
let instanceConflict = null;
const CHANNEL_RULE_MODES = new Set([
  "disabled",
  "force-enable-no-ocr",
  "force-disable-no-ocr",
  "force-enable-convert",
  "force-enable-convert-hk"
]);
let vipExpiryTimer = null;
let vipRefreshPromise = null;

function feedbackPageUrl(videoUrl) {
  const url = new URL(`${VIP_SITE}/feedback`);
  url.searchParams.set("source", "extension");
  url.searchParams.set("platform", CLIENT_PLATFORM);
  try {
    const video = new URL(String(videoUrl || ""));
    const hostname = video.hostname.toLowerCase();
    const allowedHost = hostname === "youtu.be" || hostname === "youtube.com" || hostname.endsWith(".youtube.com");
    if (video.protocol === "https:" && allowedHost) {
      video.hash = "";
      url.searchParams.set("video_url", video.toString().slice(0, 500));
    }
  } catch {}
  return url.toString();
}

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

function normalizeVipEntitlement(entitlement) {
  const trialStartedAt = String(entitlement?.trialStartedAt || "");
  const trialExpiresAt = String(entitlement?.trialExpiresAt || "");
  const trialExpiresMs = Date.parse(trialExpiresAt);
  const explicitlyTrial = entitlement?.trialActive === true
    || entitlement?.accessSource === "trial"
    || entitlement?.plan === "trial_24h";
  const backwardCompatiblePaid = entitlement?.vipActive === true && !explicitlyTrial && !trialExpiresAt;
  const paidVipActive = entitlement?.paidVipActive === true
    || entitlement?.accessSource === "paid"
    || backwardCompatiblePaid;
  const trialActive = !paidVipActive
    && explicitlyTrial
    && Number.isFinite(trialExpiresMs)
    && trialExpiresMs > Date.now();
  const checkedAt = String(entitlement?.checkedAt || "");
  const lastSuccessfulCheckAt = String(entitlement?.lastSuccessfulCheckAt || checkedAt);
  return {
    authenticated: entitlement?.authenticated === true,
    vipActive: paidVipActive || trialActive,
    paidVipActive,
    trialActive,
    trialUsed: entitlement?.trialUsed === true || Boolean(trialStartedAt && trialExpiresAt),
    trialStartedAt,
    trialExpiresAt,
    trialRemainingSeconds: trialActive ? Math.max(0, Math.ceil((trialExpiresMs - Date.now()) / 1000)) : 0,
    accessSource: paidVipActive ? "paid" : trialActive ? "trial" : "free",
    email: String(entitlement?.email || entitlement?.account?.email || ""),
    displayName: String(entitlement?.displayName || entitlement?.account?.displayName || ""),
    plan: paidVipActive ? String(entitlement?.plan || "vip_lifetime") : trialActive ? "trial_24h" : "",
    checkedAt,
    lastSuccessfulCheckAt,
    nextRetryAt: String(entitlement?.nextRetryAt || ""),
    consecutiveFailures: Math.max(0, Number(entitlement?.consecutiveFailures || 0)),
    verificationStatus: String(entitlement?.verificationStatus || "verified"),
    offlineGraceExpired: entitlement?.offlineGraceExpired === true
  };
}

function vipEntitlementActive(entitlement) {
  return normalizeVipEntitlement(entitlement).vipActive === true;
}

function scheduleVipExpiry(entitlement) {
  if (vipExpiryTimer) clearTimeout(vipExpiryTimer);
  vipExpiryTimer = null;
  if (entitlement?.trialActive !== true) return;
  const expiresAt = Date.parse(entitlement.trialExpiresAt || "");
  if (!Number.isFinite(expiresAt)) return;
  const delay = Math.max(0, Math.min(expiresAt - Date.now() + 50, 2_147_000_000));
  vipExpiryTimer = setTimeout(async () => {
    vipExpiryTimer = null;
    const current = (await localGet("vipEntitlement")).vipEntitlement;
    await storeVipEntitlement(current || entitlement);
    await refreshVipEntitlement(true).catch(() => null);
  }, delay);
  vipExpiryTimer?.unref?.();
}

async function storeVipEntitlement(entitlement) {
  const value = normalizeVipEntitlement(entitlement);
  const current = (await localGet("vipEntitlement")).vipEntitlement;
  const changed = !current
    || current.authenticated !== value.authenticated
    || current.vipActive !== value.vipActive
    || current.paidVipActive !== value.paidVipActive
    || current.trialActive !== value.trialActive
    || current.trialUsed !== value.trialUsed
    || current.trialStartedAt !== value.trialStartedAt
    || current.trialExpiresAt !== value.trialExpiresAt
    || current.accessSource !== value.accessSource
    || current.email !== value.email
    || current.displayName !== value.displayName
    || current.plan !== value.plan
    || current.lastSuccessfulCheckAt !== value.lastSuccessfulCheckAt
    || current.nextRetryAt !== value.nextRetryAt
    || current.consecutiveFailures !== value.consecutiveFailures
    || current.verificationStatus !== value.verificationStatus
    || current.offlineGraceExpired !== value.offlineGraceExpired;
  if (changed || current.checkedAt !== value.checkedAt) await chrome.storage.local.set({ vipEntitlement: value });
  if (value.vipActive) await initializeVipDefaults();
  scheduleVipExpiry(value);
  if (!value.vipActive) {
    await storeCloudSyncState({ enabled: false, pending: false, conflict: false, status: "locked", lastError: "VIP 試用或授權目前未啟用" });
  }
  if (current?.authenticated && (!value.authenticated || (current.email && value.email && current.email !== value.email))) {
    await storeCloudSyncState({
      enabled: false, revision: 0, pending: false, conflict: false,
      accountEmail: "", status: "disabled", lastError: "帳號已變更，請重新選擇是否啟用同步"
    });
  }
  if (changed) await notifyVipStatus(value);
  return value;
}

function retryDelay(failureCount) {
  const exponential = Math.min(VIP_RETRY_MAX_MS, VIP_RETRY_BASE_MS * (2 ** Math.min(6, Math.max(0, failureCount - 1))));
  return Math.round(exponential * (0.85 + Math.random() * 0.3));
}

async function storeTransientVipFailure(entitlement) {
  const current = normalizeVipEntitlement(entitlement || { authenticated: true, vipActive: false, checkedAt: "" });
  const now = Date.now();
  let lastSuccessfulMs = Date.parse(current.lastSuccessfulCheckAt || current.checkedAt || "");
  if (current.paidVipActive && !Number.isFinite(lastSuccessfulMs)) lastSuccessfulMs = now;
  const offlineGraceExpired = current.paidVipActive
    && Number.isFinite(lastSuccessfulMs)
    && now - lastSuccessfulMs > VIP_OFFLINE_GRACE_MS;
  const consecutiveFailures = current.consecutiveFailures + 1;
  const failureState = {
    ...current,
    lastSuccessfulCheckAt: Number.isFinite(lastSuccessfulMs) ? new Date(lastSuccessfulMs).toISOString() : "",
    nextRetryAt: new Date(now + retryDelay(consecutiveFailures)).toISOString(),
    consecutiveFailures,
    verificationStatus: "offline",
    offlineGraceExpired
  };
  if (offlineGraceExpired) {
    Object.assign(failureState, {
      vipActive: false,
      paidVipActive: false,
      accessSource: "free",
      plan: ""
    });
  }
  return storeVipEntitlement(failureState);
}

async function performVipEntitlementRefresh(force = false) {
  const stored = await localGet(["vipAccessToken", "vipEntitlement"]);
  if (!stored.vipAccessToken) {
    if (stored.vipEntitlement?.authenticated === false && stored.vipEntitlement?.vipActive === false) return stored.vipEntitlement;
    return storeVipEntitlement({ authenticated: false, vipActive: false });
  }
  const normalizedStored = normalizeVipEntitlement(stored.vipEntitlement || { authenticated: true, vipActive: false });
  if (normalizedStored.vipActive !== stored.vipEntitlement?.vipActive
    || normalizedStored.trialActive !== stored.vipEntitlement?.trialActive) {
    await storeVipEntitlement(normalizedStored);
  } else {
    scheduleVipExpiry(normalizedStored);
  }
  const checkedAt = Date.parse(normalizedStored.checkedAt || "");
  const nextRetryAt = Date.parse(normalizedStored.nextRetryAt || "");
  if (!force && Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) return normalizedStored;
  if (!force && Number.isFinite(checkedAt) && Date.now() - checkedAt < VIP_REFRESH_INTERVAL_MS) return normalizedStored;
  try {
    const response = await fetch(`${VIP_SITE}/api/extension/entitlement`, {
      headers: { authorization: `Bearer ${stored.vipAccessToken}` },
      cache: "no-store"
    });
    if (!response.ok) {
      if (response.status === 401) {
        await chrome.storage.local.remove("vipAccessToken");
        return storeVipEntitlement({ authenticated: false, vipActive: false });
      }
      throw new Error(`vip-http-${response.status}`);
    }
    const result = await response.json();
    const successfulAt = String(result.checkedAt || new Date().toISOString());
    return storeVipEntitlement({
      ...result,
      checkedAt: successfulAt,
      lastSuccessfulCheckAt: successfulAt,
      nextRetryAt: "",
      consecutiveFailures: 0,
      verificationStatus: "verified",
      offlineGraceExpired: false
    });
  } catch {
    return storeTransientVipFailure(stored.vipEntitlement);
  }
}

function refreshVipEntitlement(force = false) {
  if (vipRefreshPromise) return vipRefreshPromise;
  vipRefreshPromise = performVipEntitlementRefresh(force).finally(() => { vipRefreshPromise = null; });
  return vipRefreshPromise;
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
    const response = await fetch(VIP_AUTH_STATUS_URL);
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
  if (Platform.capabilities.extensionIdentity?.available !== true) {
    const message = Platform.isSafari
      ? "Safari Mac 的帳號連接仍需在 Mac／Xcode 完成驗證，已開啟會員中心。"
      : "目前瀏覽器不支援插件帳號連接，已開啟會員中心。";
    await storeVipAuthNotice(message);
    await chrome.tabs.create({ url: `${VIP_SITE}/account?source=extension&platform=${encodeURIComponent(CLIENT_PLATFORM)}` });
    throw new Error(message);
  }
  const googleReady = await checkGoogleAuthReady();
  if (googleReady === false) {
    const message = "Google 登入服務尚未完成設定，已開啟會員中心說明。";
    await storeVipAuthNotice(message);
    await chrome.tabs.create({ url: VIP_ACCOUNT_SETUP_URL });
    throw new Error(message);
  }
  const redirectUri = chrome.identity.getRedirectURL("vip");
  const authorizeUrl = `${VIP_SITE}/extension/connect?redirect_uri=${encodeURIComponent(redirectUri)}&platform=${encodeURIComponent(CLIENT_PLATFORM)}`;
  const callbackUrl = new URL(await launchWebAuthFlow(authorizeUrl));
  const code = callbackUrl.searchParams.get("code");
  const purchaseAfterConnect = callbackUrl.searchParams.get("purchase") === "1";
  const callbackPlatform = ["chrome", "edge", "firefox", "safari-macos"].includes(callbackUrl.searchParams.get("platform"))
    ? callbackUrl.searchParams.get("platform")
    : CLIENT_PLATFORM;
  if (!code) throw new Error("網站沒有回傳插件授權碼");
  const response = await fetch(`${VIP_SITE}/api/extension/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, redirectUri, platform: callbackPlatform })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.accessToken) throw new Error("無法完成插件授權");
  await chrome.storage.local.set({ vipAccessToken: result.accessToken });
  await chrome.storage.local.remove("vipAuthNotice");
  const entitlement = await storeVipEntitlement({
    authenticated: true,
    ...result.account,
    checkedAt: new Date().toISOString(),
    lastSuccessfulCheckAt: new Date().toISOString(),
    verificationStatus: "verified"
  });
  if (purchaseAfterConnect && entitlement.paidVipActive !== true) {
    await chrome.tabs.create({ url: `${VIP_SITE}/checkout?platform=${encodeURIComponent(callbackPlatform)}` });
  }
  return entitlement;
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
    accountEmail: "",
    nextRetryAt: "",
    consecutiveFailures: 0
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
  if (!stored.vipAccessToken || !vipEntitlementActive(stored.vipEntitlement)) {
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
    error.retryAfter = Math.max(0, Number(response.headers?.get?.("retry-after") || 0));
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
  if (!vipEntitlementActive(entitlement)) {
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
  const nextRetryAt = Date.parse(state.nextRetryAt || "");
  if (mode === "auto" && Number.isFinite(nextRetryAt) && nextRetryAt > Date.now()) {
    return { state, data: await getLocalCloudData() };
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
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: "",
        nextRetryAt: "", consecutiveFailures: 0
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
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: "",
        nextRetryAt: "", consecutiveFailures: 0
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
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: "",
        nextRetryAt: "", consecutiveFailures: 0
      });
      return { state: next, data: localData };
    }

    if (Number(remote.revision || 0) > Number(state.revision || 0)) {
      const data = await storeLocalCloudData(remoteData);
      const next = await storeCloudSyncState({
        revision: Number(remote.revision || 0), pending: false, conflict: false,
        status: "synced", lastSyncedAt: new Date().toISOString(), lastError: "",
        nextRetryAt: "", consecutiveFailures: 0
      });
      return { state: next, data };
    }

    const next = await storeCloudSyncState({
      revision: Number(remote.revision || state.revision || 0), conflict: false,
      status: "synced", lastSyncedAt: new Date().toISOString(), lastError: "",
      nextRetryAt: "", consecutiveFailures: 0
    });
    return { state: next, data: localData };
  } catch (error) {
    if (error.code === "conflict") {
      const next = await storeCloudSyncState({
        conflict: true, status: "conflict", lastError: "本機與網站都有新修改，請選擇要保留哪一份",
        nextRetryAt: "", consecutiveFailures: 0
      });
      return { state: next, data: await getLocalCloudData() };
    }
    const consecutiveFailures = Math.max(0, Number(state.consecutiveFailures || 0)) + 1;
    const retryAfterMs = Number(error.retryAfter || 0) > 0
      ? Number(error.retryAfter) * 1000
      : retryDelay(consecutiveFailures);
    const next = await storeCloudSyncState({
      status: "offline", lastError: "目前無法連接同步服務，本機設定會繼續正常使用",
      nextRetryAt: new Date(Date.now() + retryAfterMs).toISOString(),
      consecutiveFailures
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
      enabled: false, pending: false, conflict: false, status: "disabled", lastError: "",
      nextRetryAt: "", consecutiveFailures: 0
    });
    return { state, data: await getLocalCloudData() };
  }
  const entitlement = (await localGet("vipEntitlement")).vipEntitlement;
  if (!vipEntitlementActive(entitlement)) {
    return { state: await storeCloudSyncState({ enabled: false, status: "locked", lastError: "VIP 尚未啟用" }) };
  }
  const localData = await getLocalCloudData();
  const hasLocalData = localData.customReplacements.length > 0 || localData.channelRules.length > 0;
  await storeCloudSyncState({
    enabled: true, pending: hasLocalData, conflict: false, status: "syncing", lastError: "",
    accountEmail: String(entitlement.email || ""), nextRetryAt: "", consecutiveFailures: 0
  });
  return syncCloudData("auto");
}

async function markCloudDataChanged() {
  const state = await getCloudSyncState();
  if (!state.enabled) return { state, data: await getLocalCloudData() };
  const retryPending = Date.parse(state.nextRetryAt || "") > Date.now();
  await storeCloudSyncState({
    pending: true,
    status: retryPending ? "offline" : "pending",
    lastError: retryPending ? state.lastError : ""
  });
  return syncCloudData("auto");
}

function actionIconPaths(enabled) {
  const state = enabled ? "enabled" : "disabled";
  return Object.fromEntries(ACTION_ICON_SIZES.map((size) => [size, `icons/${state}-${size}.png`]));
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function externalInstanceInfo(extensionId) {
  return new Promise((resolve) => {
    if (!InstanceCoordinator?.validExtensionId(extensionId) || extensionId === OWN_INSTANCE.extensionId) {
      resolve(null);
      return;
    }
    try {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      const pending = chrome.runtime.sendMessage(extensionId, {
        type: "ytlang:instance-info",
        product: InstanceCoordinator.PRODUCT,
        protocolVersion: InstanceCoordinator.PROTOCOL_VERSION,
        distribution: OWN_INSTANCE.distribution
      }, (response) => finish(chrome.runtime.lastError ? null : response));
      if (pending?.then) pending.then(finish).catch(() => finish(null));
    } catch {
      resolve(null);
    }
  });
}

async function broadcastInstanceConflict() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.youtube.com/*" });
    await Promise.allSettled((tabs || []).filter((tab) => Number.isInteger(tab.id)).map((tab) =>
      chrome.tabs.sendMessage(tab.id, { type: "ytlang:instance-conflict", conflict: instanceConflict })
    ));
  } catch {}
}

async function setInstanceConflict(conflict) {
  instanceConflict = conflict || null;
  await updateActionState(true);
  await broadcastInstanceConflict();
}

async function evaluatePeerInstance(extensionId) {
  if (!InstanceCoordinator || !["chrome", "edge"].includes(Platform.target)) return null;
  const peer = await externalInstanceInfo(extensionId);
  const validPeer = peer
    && peer.product === InstanceCoordinator.PRODUCT
    && peer.protocolVersion === InstanceCoordinator.PROTOCOL_VERSION
    && peer.extensionId === extensionId
    && InstanceCoordinator.validExtensionId(peer.extensionId);
  if (!validPeer) {
    if (instanceConflict?.winnerExtensionId === extensionId) await setInstanceConflict(null);
    return instanceConflict;
  }
  const winner = InstanceCoordinator.preferredInstance(OWN_INSTANCE, peer);
  if (winner.extensionId !== OWN_INSTANCE.extensionId) {
    await setInstanceConflict({
      active: true,
      winnerExtensionId: peer.extensionId,
      winnerVersion: peer.version,
      winnerDistribution: peer.distribution,
      currentVersion: OWN_INSTANCE.version,
      currentDistribution: OWN_INSTANCE.distribution,
      reason: InstanceCoordinator.compareVersions(peer.version, OWN_INSTANCE.version) > 0
        ? "newer-version"
        : peer.distribution === InstanceCoordinator.DEVELOPMENT_DISTRIBUTION
          && OWN_INSTANCE.distribution === InstanceCoordinator.CHROME_STORE_DISTRIBUTION
          ? "same-version-development-priority"
          : "same-version-tiebreak"
    });
  } else if (instanceConflict?.winnerExtensionId === peer.extensionId) {
    await setInstanceConflict(null);
  }
  return instanceConflict;
}

async function setActionIconSafely(enabled) {
  const path = actionIconPaths(enabled);
  const retryDelays = [0, 80, 240];
  for (const retryDelay of retryDelays) {
    if (retryDelay) await wait(retryDelay);
    try {
      await chrome.action.setIcon({ path });
      return true;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/extension context invalidated/i.test(message)) return false;
    }
  }
  return false;
}

async function updateActionState(enabled) {
  const effectiveEnabled = enabled && !instanceConflict?.active;
  const results = await Promise.allSettled([
    setActionIconSafely(effectiveEnabled),
    chrome.action.setTitle({ title: instanceConflict?.active
      ? `Youtube 字幕全自動開關：另一個優先版本 v${instanceConflict.winnerVersion} 已接管`
      : `Youtube 字幕全自動開關：${enabled ? "已開啟" : "已關閉"}` }),
    chrome.action.setBadgeText({ text: instanceConflict?.active ? "OLD" : effectiveEnabled ? "" : "OFF" }),
    chrome.action.setBadgeBackgroundColor({ color: instanceConflict?.active ? "#C04B3F" : "#7A8288" })
  ]);
  return results.every((result) => result.status === "fulfilled");
}

async function syncActionState() {
  try {
    const result = await chrome.storage.sync.get("settings");
    return updateActionState(result.settings?.enabled !== false);
  } catch {
    return false;
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) return;
  void updateActionState(changes.settings.newValue?.enabled !== false);
});

chrome.runtime.onInstalled.addListener(() => {
  void syncActionState();
  refreshVipEntitlement().then(() => syncCloudData("auto")).catch(() => null);
});
chrome.runtime.onStartup.addListener(() => {
  void syncActionState();
  refreshVipEntitlement().then(() => syncCloudData("auto")).catch(() => null);
});
void syncActionState();

if (InstanceCoordinator && ["chrome", "edge"].includes(Platform.target) && chrome.runtime.onMessageExternal?.addListener) {
  chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
    if (message?.type !== "ytlang:instance-info"
      || message.product !== InstanceCoordinator.PRODUCT
      || message.protocolVersion !== InstanceCoordinator.PROTOCOL_VERSION
      || !InstanceCoordinator.validExtensionId(sender?.id)
      || sender.id === OWN_INSTANCE.extensionId) return false;
    sendResponse({
      product: InstanceCoordinator.PRODUCT,
      protocolVersion: InstanceCoordinator.PROTOCOL_VERSION,
      extensionId: OWN_INSTANCE.extensionId,
      version: OWN_INSTANCE.version,
      distribution: OWN_INSTANCE.distribution
    });
    return false;
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ytlang:instance-peer") {
    evaluatePeerInstance(String(message.extensionId || ""))
      .then((conflict) => sendResponse({ ok: true, conflict }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "ytlang:instance-conflict-status") {
    sendResponse({ ok: true, conflict: instanceConflict });
    return false;
  }

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

  if (message?.type === "ytlang:open-feedback") {
    chrome.tabs.create({ url: feedbackPageUrl(message.videoUrl) })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
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

  if (Platform.capabilities.embeddedSubtitleDetection?.available !== true) {
    sendResponse({ ok: false, reason: "capture-unavailable", experimental: Platform.isSafari });
    return false;
  }

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
        .then((dataUrl) => sendResponse(Platform.isSafari
          ? { ok: true, dataUrl, experimental: true }
          : { ok: true, dataUrl }));
    })
    .catch((error) => sendResponse({ ok: false, reason: "capture-failed", message: error.message }));
  return true;
});
