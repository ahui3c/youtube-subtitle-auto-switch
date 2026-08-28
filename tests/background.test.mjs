import test from "node:test";
import assert from "node:assert/strict";

let messageListener;
let storageChangeListener;
let activeTabId = 7;
let captureCalls = 0;
let lastIconPath;
let lastTitle;
let lastBadgeText;
let iconSetCalls = 0;
let iconFailuresRemaining = 0;
let injectedScripts = [];
let openedTabUrl = "";
let localStorage = {};
let syncStorage = { settings: { enabled: true } };
let googleReady = false;
let cloudOffline = false;
let entitlementOffline = false;
let entitlementFetchCalls = 0;
let cloudFetchCalls = 0;
let entitlementResult = null;
let extensionTokenResult = null;
let oauthRedirectUrl = "";
let cloudRemote = { revision: 0, updatedAt: "", customReplacements: [], channelRules: [] };

globalThis.fetch = async (url, options = {}) => {
  if (String(url).endsWith("/api/auth/status")) {
    return { ok: true, async json() { return { googleReady }; } };
  }
  if (String(url).endsWith("/api/extension/entitlement")) {
    if (String(options.method || "GET").toUpperCase() === "POST") return { ok: true, async json() { return { ok: true }; } };
    entitlementFetchCalls += 1;
    if (entitlementOffline) throw new Error("offline");
    if (!entitlementResult) return { ok: false, status: 401, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return entitlementResult; } };
  }
  if (String(url).endsWith("/api/extension/token")) {
    if (!extensionTokenResult) return { ok: false, status: 400, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return structuredClone(extensionTokenResult); } };
  }
  if (String(url).endsWith("/api/extension/sync")) {
    cloudFetchCalls += 1;
    if (cloudOffline) throw new Error("offline");
    const method = String(options.method || "GET").toUpperCase();
    if (method === "GET") return { ok: true, status: 200, async json() { return structuredClone(cloudRemote); } };
    const body = JSON.parse(options.body || "{}");
    if (body.baseRevision !== cloudRemote.revision) {
      return { ok: false, status: 409, async json() { return { message: "conflict", current: structuredClone(cloudRemote) }; } };
    }
    cloudRemote = {
      revision: cloudRemote.revision + 1,
      updatedAt: new Date().toISOString(),
      customReplacements: body.customReplacements,
      channelRules: body.channelRules
    };
    return { ok: true, status: 200, async json() { return structuredClone(cloudRemote); } };
  }
  throw new Error(`unexpected fetch: ${url}`);
};

globalThis.chrome = {
  runtime: {
    lastError: undefined,
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      }
    }
  },
  storage: {
    sync: {
      get(keys, callback) {
        const value = structuredClone(syncStorage);
        callback?.(value);
        return Promise.resolve(value);
      },
      async set(value) {
        Object.assign(syncStorage, structuredClone(value));
      }
    },
    local: {
      get(keys, callback) {
        const names = Array.isArray(keys) ? keys : [keys];
        const result = Object.fromEntries(names.filter((key) => key in localStorage).map((key) => [key, localStorage[key]]));
        callback(result);
      },
      async set(value) {
        Object.assign(localStorage, value);
      },
      async remove(key) {
        delete localStorage[key];
      }
    },
    onChanged: {
      addListener(listener) {
        storageChangeListener = listener;
      }
    }
  },
  action: {
    async setIcon({ path }) {
      iconSetCalls += 1;
      if (iconFailuresRemaining > 0) {
        iconFailuresRemaining -= 1;
        throw new Error(`Failed to set icon '${path[16]}': Failed to fetch`);
      }
      lastIconPath = path;
    },
    async setTitle({ title }) {
      lastTitle = title;
    },
    async setBadgeText({ text }) {
      lastBadgeText = text;
    },
    async setBadgeBackgroundColor() {
    }
  },
  scripting: {
    async executeScript(details) {
      injectedScripts.push(details);
      if (details.files) globalThis.OpenCC = { Converter() {} };
      return details.func ? [{ result: Boolean(globalThis.OpenCC?.Converter) }] : [];
    }
  },
  identity: {
    getRedirectURL(path) {
      return `https://extension-id.chromiumapp.org/${path}`;
    },
    launchWebAuthFlow(options, callback) {
      if (!oauthRedirectUrl) throw new Error("這個測試不應啟動 OAuth 視窗");
      callback(oauthRedirectUrl);
    }
  },
  tabs: {
    async query() {
      return [{ id: activeTabId }];
    },
    async sendMessage() {
      return { ok: true };
    },
    async captureVisibleTab(windowId, options) {
      captureCalls += 1;
      assert.equal(windowId, 3);
      assert.deepEqual(options, { format: "png" });
      return "data:image/png;base64,test";
    },
    async create({ url }) {
      openedTabUrl = url;
    }
  }
};

await import("../src/background.js");
await new Promise((resolve) => setImmediate(resolve));

function sendCapture(sender = { tab: { id: 7, windowId: 3 } }) {
  return new Promise((resolve) => {
    const keepChannelOpen = messageListener({ type: "ytlang:capture-frame" }, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

function sendMessage(message, sender = {}) {
  return new Promise((resolve) => {
    const keepChannelOpen = messageListener(message, sender, resolve);
    assert.equal(keepChannelOpen, true);
  });
}

test("不需先開啟面板或 arm 訊息即可擷取目前 YouTube 分頁", async () => {
  activeTabId = 7;
  captureCalls = 0;
  const response = await sendCapture();
  assert.deepEqual(response, { ok: true, dataUrl: "data:image/png;base64,test" });
  assert.equal(captureCalls, 1);
});

test("分頁不在前景時不會誤擷取其他分頁", async () => {
  activeTabId = 9;
  captureCalls = 0;
  const response = await sendCapture();
  assert.deepEqual(response, { ok: false, reason: "tab-not-active" });
  assert.equal(captureCalls, 0);
});

test("總開關會即時切換彩色與黑白圖示", async () => {
  assert.equal(lastIconPath[16], "icons/enabled-16.png");
  assert.equal(lastTitle, "Youtube 字幕全自動開關：已開啟");

  storageChangeListener({ settings: { newValue: { enabled: false } } }, "sync");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lastIconPath[16], "icons/disabled-16.png");
  assert.equal(lastTitle, "Youtube 字幕全自動開關：已關閉");
  assert.equal(lastBadgeText, "OFF");
});

test("面板可直接要求背景校正工具列圖示", async () => {
  const disabled = await sendMessage({ type: "ytlang:update-action-state", enabled: false });
  assert.deepEqual(disabled, { ok: true });
  assert.equal(lastIconPath[32], "icons/disabled-32.png");
  assert.equal(lastTitle, "Youtube 字幕全自動開關：已關閉");

  const enabled = await sendMessage({ type: "ytlang:update-action-state", enabled: true });
  assert.deepEqual(enabled, { ok: true });
  assert.equal(lastIconPath[32], "icons/enabled-32.png");
  assert.equal(lastTitle, "Youtube 字幕全自動開關：已開啟");
  assert.equal(lastBadgeText, "");
});

test("工具列圖示暫時無法載入時會安全重試且不回傳未捕捉錯誤", async () => {
  const callsBeforeRetry = iconSetCalls;
  iconFailuresRemaining = 1;
  const response = await sendMessage({ type: "ytlang:update-action-state", enabled: true });

  assert.deepEqual(response, { ok: true });
  assert.equal(iconSetCalls, callsBeforeRetry + 2);
  assert.equal(lastIconPath[16], "icons/enabled-16.png");
});

test("OpenCC 按需注入後會在同一隔離環境驗證載入結果", async () => {
  injectedScripts = [];
  const response = await sendMessage({ type: "ytlang:load-opencc" }, { tab: { id: 7 }, frameId: 0 });
  assert.deepEqual(response, { ok: true, reason: "" });
  assert.equal(injectedScripts.length, 2);
  assert.deepEqual(injectedScripts[0], {
    target: { tabId: 7, frameIds: [0] },
    files: ["vendor/opencc.js"]
  });
  assert.equal(typeof injectedScripts[1].func, "function");
});

test("Google OAuth 尚未設定時會開啟會員中心並回傳明確訊息", async () => {
  googleReady = false;
  openedTabUrl = "";
  localStorage = {};
  const response = await sendMessage({ type: "ytlang:vip-login" });
  assert.equal(response.ok, false);
  assert.match(response.message, /Google 登入服務尚未完成設定/);
  assert.equal(openedTabUrl, "https://myapp.ahui3c.com/account?source=extension&error=google_not_configured");
  assert.match(localStorage.vipAuthNotice.message, /已開啟會員中心/);
});

test("尚未購買 VIP 時連接會啟用 24 小時試用並可繼續前往購買頁", async () => {
  googleReady = true;
  openedTabUrl = "";
  localStorage = {};
  oauthRedirectUrl = "https://extension-id.chromiumapp.org/vip?code=connect-code&purchase=1";
  extensionTokenResult = {
    accessToken: "access-token",
    account: {
      vipActive: true,
      paidVipActive: false,
      trialActive: true,
      trialUsed: true,
      accessSource: "trial",
      plan: "trial_24h",
      trialStartedAt: new Date().toISOString(),
      trialExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      email: "free@example.com",
      displayName: "Free User"
    }
  };

  const response = await sendMessage({ type: "ytlang:vip-login" });
  assert.equal(response.ok, true);
  assert.equal(response.entitlement.authenticated, true);
  assert.equal(response.entitlement.vipActive, true);
  assert.equal(response.entitlement.trialActive, true);
  assert.equal(response.entitlement.paidVipActive, false);
  assert.equal(localStorage.vipAccessToken, "access-token");
  assert.equal(openedTabUrl, "https://myapp.ahui3c.com/checkout");

  oauthRedirectUrl = "";
  extensionTokenResult = null;
});

test("試用到期後即使收到舊的啟用旗標也會關閉 VIP", async () => {
  localStorage = {
    vipAccessToken: "expired-trial-token",
    vipEntitlement: {
      authenticated: true,
      vipActive: true,
      paidVipActive: false,
      trialActive: true,
      trialUsed: true,
      accessSource: "trial",
      plan: "trial_24h",
      trialStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      trialExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      email: "trial@example.com",
      checkedAt: new Date().toISOString()
    }
  };
  entitlementResult = structuredClone(localStorage.vipEntitlement);

  const response = await sendMessage({ type: "ytlang:vip-get-status", force: true });
  assert.equal(response.entitlement.vipActive, false);
  assert.equal(response.entitlement.trialActive, false);
  assert.equal(response.entitlement.trialUsed, true);
  assert.equal(localStorage.cloudSyncState.enabled, false);
  assert.equal(localStorage.cloudSyncState.status, "locked");
});

test("首次取得 VIP 會套用三項指定預設值", async () => {
  localStorage = {
    vipAccessToken: "token",
    vipEntitlement: { authenticated: true, vipActive: false, email: "vip@example.com", checkedAt: "" }
  };
  syncStorage = { settings: { enabled: true, taiwanTermsEnabled: false, hongKongColloquialEnabled: true, customReplacementsEnabled: false } };
  entitlementResult = { authenticated: true, vipActive: true, email: "vip@example.com", checkedAt: new Date().toISOString() };
  const response = await sendMessage({ type: "ytlang:vip-get-status", force: true });
  assert.equal(response.entitlement.vipActive, true);
  assert.equal(syncStorage.settings.taiwanTermsEnabled, true);
  assert.equal(syncStorage.settings.customReplacementsEnabled, true);
  assert.equal(syncStorage.settings.hongKongColloquialEnabled, false);
  assert.equal(syncStorage.settings.vipDefaultsVersion, 1);
});

test("VIP 狀態在快取期間不會重複向伺服器查詢", async () => {
  entitlementFetchCalls = 0;
  localStorage = {
    vipAccessToken: "cached-token",
    vipEntitlement: {
      authenticated: true,
      vipActive: true,
      paidVipActive: true,
      accessSource: "paid",
      email: "cached@example.com",
      checkedAt: new Date().toISOString(),
      lastSuccessfulCheckAt: new Date().toISOString()
    }
  };
  const first = await sendMessage({ type: "ytlang:vip-get-status" });
  const second = await sendMessage({ type: "ytlang:vip-get-status" });
  assert.equal(first.entitlement.vipActive, true);
  assert.equal(second.entitlement.vipActive, true);
  assert.equal(entitlementFetchCalls, 0);
});

test("短暫離線時保留已購買 VIP 並套用退避時間", async () => {
  entitlementOffline = true;
  localStorage = {
    vipAccessToken: "offline-paid-token",
    vipEntitlement: {
      authenticated: true,
      vipActive: true,
      paidVipActive: true,
      accessSource: "paid",
      email: "paid@example.com",
      checkedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      lastSuccessfulCheckAt: new Date(Date.now() - 60 * 60 * 1000).toISOString()
    }
  };
  const response = await sendMessage({ type: "ytlang:vip-get-status", force: true });
  assert.equal(response.entitlement.vipActive, true);
  assert.equal(response.entitlement.verificationStatus, "offline");
  assert.ok(Date.parse(response.entitlement.nextRetryAt) > Date.now());
  entitlementOffline = false;
});

test("已購買 VIP 超過七天無法驗證時會暫停進階功能", async () => {
  entitlementOffline = true;
  localStorage = {
    vipAccessToken: "stale-paid-token",
    vipEntitlement: {
      authenticated: true,
      vipActive: true,
      paidVipActive: true,
      accessSource: "paid",
      email: "stale@example.com",
      checkedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      lastSuccessfulCheckAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    }
  };
  const response = await sendMessage({ type: "ytlang:vip-get-status", force: true });
  assert.equal(response.entitlement.vipActive, false);
  assert.equal(response.entitlement.offlineGraceExpired, true);
  assert.equal(localStorage.cloudSyncState.status, "locked");
  entitlementOffline = false;
});

test("雲端同步預設關閉，啟用後會安全上傳本機資料", async () => {
  localStorage = {
    vipAccessToken: "token",
    vipEntitlement: { authenticated: true, vipActive: true, email: "vip@example.com" },
    customReplacements: [{ from: "軟件", to: "軟體", enabled: true }],
    channelRules: [{ channelId: "UC-1", channelName: "測試頻道", mode: "force-enable-no-ocr" }]
  };
  cloudRemote = { revision: 0, updatedAt: "", customReplacements: [], channelRules: [] };
  cloudOffline = false;
  const before = await sendMessage({ type: "ytlang:cloud-sync-status" });
  assert.equal(before.state.enabled, false);
  const enabled = await sendMessage({ type: "ytlang:cloud-sync-enable", enabled: true });
  assert.equal(enabled.state.enabled, true);
  assert.equal(enabled.state.status, "synced");
  assert.equal(enabled.state.pending, false);
  assert.equal(cloudRemote.revision, 1);
  assert.deepEqual(cloudRemote.customReplacements, localStorage.customReplacements);
});

test("離線時保留待同步狀態且不影響本機資料", async () => {
  localStorage.cloudSyncState = {
    enabled: true, revision: 1, pending: false, conflict: false,
    status: "synced", accountEmail: "vip@example.com"
  };
  cloudOffline = true;
  cloudFetchCalls = 0;
  const response = await sendMessage({ type: "ytlang:cloud-sync-local-changed" });
  assert.equal(response.state.status, "offline");
  assert.equal(response.state.pending, true);
  assert.ok(Date.parse(response.state.nextRetryAt) > Date.now());
  assert.deepEqual(response.data.customReplacements, localStorage.customReplacements);
  const retried = await sendMessage({ type: "ytlang:cloud-sync-local-changed" });
  assert.equal(retried.state.status, "offline");
  assert.equal(cloudFetchCalls, 1);
  cloudOffline = false;
});

test("本機與網站同時修改時不會靜默覆蓋並可選擇網站版本", async () => {
  localStorage.cloudSyncState = {
    enabled: true, revision: 1, pending: false, conflict: false,
    status: "synced", accountEmail: "vip@example.com"
  };
  localStorage.customReplacements = [{ from: "本機", to: "本機資料", enabled: true }];
  cloudRemote = {
    revision: 2,
    updatedAt: new Date().toISOString(),
    customReplacements: [{ from: "網站", to: "網站資料", enabled: true }],
    channelRules: []
  };
  const conflict = await sendMessage({ type: "ytlang:cloud-sync-local-changed" });
  assert.equal(conflict.state.conflict, true);
  assert.deepEqual(localStorage.customReplacements, [{ from: "本機", to: "本機資料", enabled: true }]);

  const resolved = await sendMessage({ type: "ytlang:cloud-sync-now", mode: "cloud" });
  assert.equal(resolved.state.conflict, false);
  assert.equal(resolved.state.revision, 2);
  assert.deepEqual(localStorage.customReplacements, cloudRemote.customReplacements);
});
