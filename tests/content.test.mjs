import test from "node:test";
import assert from "node:assert/strict";
import { Converter } from "opencc-js";

await import("../src/core.js");

const listeners = new Map();
const segment = { textContent: "软件保存的信息", isConnected: true };
let mutationCallback;
let observeCount = 0;
let disconnectCount = 0;
let localStatusWrites = 0;
let runtimeMessageListener;
const appliedPlans = [];
let enableCaptionEvents = 0;
let disableCaptionEvents = 0;

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

globalThis.CustomEvent = FakeCustomEvent;
globalThis.MutationObserver = class {
  constructor(callback) {
    mutationCallback = callback;
  }
  observe() {
    observeCount += 1;
  }
  disconnect() {
    disconnectCount += 1;
  }
};

globalThis.document = {
  body: {},
  visibilityState: "visible",
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
  dispatchEvent(event) {
    for (const listener of listeners.get(event.type) || []) listener(event);
    return true;
  },
  querySelectorAll(selector) {
    return selector === ".ytp-caption-segment" ? [segment] : [];
  },
  querySelector() {
    return null;
  }
};

const converter = Converter({ from: "cn", to: "twp" });
const storedSettings = {
  settingsVersion: 6,
  enabled: true,
  autoEnableCaptions: false,
  simplifiedMode: "opencc",
  embeddedDetection: false,
  taiwanTermsEnabled: true,
  customReplacementsEnabled: true
};

globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      if (message.type === "ytlang:load-opencc") {
        globalThis.OpenCC = { Converter: () => converter };
        queueMicrotask(() => callback({ ok: true, reason: "" }));
        return;
      }
      queueMicrotask(() => callback?.({ ok: true }));
    },
    onMessage: {
      addListener(listener) {
        runtimeMessageListener = listener;
      }
    }
  },
  storage: {
    sync: {
      get(key, callback) {
        callback({ settings: storedSettings });
      },
      async set() {}
    },
    local: {
      get(keys, callback) {
        callback({
          customReplacements: [],
          channelRules: [],
          vipEntitlement: { authenticated: true, vipActive: true, email: "vip@example.com" }
        });
      },
      set(value) {
        if (value.status) localStatusWrites += 1;
        return Promise.resolve();
      }
    }
  }
};

document.addEventListener("ytlang:apply-plan", (event) => appliedPlans.push(event.detail));
document.addEventListener("ytlang:enable-captions", () => { enableCaptionEvents += 1; });
document.addEventListener("ytlang:disable-captions", () => { disableCaptionEvents += 1; });

await import("../src/content.js");

function emit(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

function testPlayerData() {
  return {
    videoId: "video-1",
    title: "測試影片",
    channelId: "channel-1",
    channelName: "測試頻道",
    captionTracks: [{
      languageCode: "zh-CN",
      name: "中文（簡體）",
      isAutomatic: false,
      isTranslatable: true,
      vssId: ".zh-CN"
    }],
    translationLanguages: [{ languageCode: "zh-Hant", name: "中文（繁體）" }]
  };
}

test("本機轉換、字幕監聽生命週期與狀態去重可共同運作", async () => {
  await settle();
  const player = testPlayerData();

  emit("ytlang:player-data", player);
  mutationCallback?.([]);
  await settle();
  assert.equal(segment.textContent, "軟體儲存的資訊");
  assert.ok(observeCount >= 1);

  const writesBeforeApply = localStatusWrites;
  emit("ytlang:apply-result", { ok: true });
  emit("ytlang:apply-result", { ok: true });
  assert.equal(localStatusWrites, writesBeforeApply + 1);

  document.visibilityState = "hidden";
  emit("visibilitychange");
  assert.ok(disconnectCount >= 1);

  document.visibilityState = "visible";
  emit("visibilitychange");
  const disconnectBeforeNoCc = disconnectCount;
  emit("ytlang:player-data", { ...player, captionTracks: [] });
  assert.ok(disconnectCount > disconnectBeforeNoCc);

  assert.equal(typeof runtimeMessageListener, "function");
});

test("強制開啟字幕不啟動 OCR 且不改變原有字幕計畫", async () => {
  await settle();
  emit("ytlang:player-data", testPlayerData());

  const plansBeforeEnable = appliedPlans.length;
  let enableResponse;
  runtimeMessageListener({
    type: "ytlang:settings-updated",
    settings: {
      ...storedSettings,
      embeddedDetection: true,
      channelRules: [{
        channelId: "channel-1",
        channelName: "測試頻道",
        mode: "force-enable-no-ocr"
      }]
    }
  }, {}, (response) => { enableResponse = response; });

  assert.equal(enableResponse.status.captureArmed, false);
  assert.equal(enableResponse.status.detectionSkipReason, "channel-force-enable-no-ocr");
  assert.equal(appliedPlans.length, plansBeforeEnable + 1);
  assert.equal(appliedPlans.at(-1).type, "opencc");
  assert.equal(enableCaptionEvents, 0);

  const enablesBeforeFallback = enableCaptionEvents;
  emit("ytlang:player-data", {
    ...testPlayerData(),
    captionTracks: [],
    hasCaptionControl: true
  });
  assert.equal(enableCaptionEvents, enablesBeforeFallback + 1);
});

test("強制簡繁轉換會處理任何語言字幕並套用已啟用的台灣及自訂用語", async () => {
  await settle();
  segment.textContent = "软件保存的信息";
  emit("ytlang:player-data", {
    ...testPlayerData(),
    captionTracks: [{
      languageCode: "en",
      name: "English",
      isAutomatic: false,
      isTranslatable: true,
      vssId: ".en"
    }]
  });

  let response;
  runtimeMessageListener({
    type: "ytlang:settings-updated",
    settings: {
      ...storedSettings,
      simplifiedMode: "youtube",
      embeddedDetection: true,
      taiwanTermsEnabled: true,
      customReplacementsEnabled: true,
      customReplacements: [{ from: "軟體", to: "程式", enabled: true }],
      channelRules: [{
        channelId: "channel-1",
        channelName: "測試頻道",
        mode: "force-enable-convert"
      }]
    }
  }, {}, (result) => { response = result; });

  mutationCallback?.([]);
  await settle();
  assert.equal(response.status.captureArmed, false);
  assert.equal(response.status.detectionSkipReason, "channel-force-enable-convert-no-ocr");
  assert.equal(response.status.planType, "channel-force-enable");
  assert.equal(segment.textContent, "程式儲存的資訊");
});

test("強制簡繁粵語轉換不依賴全域粵語開關", async () => {
  await settle();
  segment.textContent = "我哋而家睇下软件";
  emit("ytlang:player-data", testPlayerData());

  let response;
  runtimeMessageListener({
    type: "ytlang:settings-updated",
    settings: {
      ...storedSettings,
      simplifiedMode: "youtube",
      hongKongColloquialEnabled: false,
      customReplacementsEnabled: false,
      channelRules: [{
        channelId: "channel-1",
        channelName: "測試頻道",
        mode: "force-enable-convert-hk"
      }]
    }
  }, {}, (result) => { response = result; });

  mutationCallback?.([]);
  await settle();
  assert.equal(response.status.captureArmed, false);
  assert.equal(response.status.detectionSkipReason, "channel-force-enable-convert-hk-no-ocr");
  assert.equal(segment.textContent, "我們現在看一下軟體");
});

test("總開關關閉時指定頻道規則不會強制啟用字幕", () => {
  const enablesBeforeMasterOff = enableCaptionEvents;
  const disablesBeforeMasterOff = disableCaptionEvents;

  let masterOffResponse;
  runtimeMessageListener({
    type: "ytlang:settings-updated",
    settings: {
      ...storedSettings,
      enabled: false,
      embeddedDetection: true,
      channelRules: [{
        channelId: "channel-1",
        channelName: "測試頻道",
        mode: "force-enable-convert-hk"
      }]
    }
  }, {}, (response) => { masterOffResponse = response; });
  assert.equal(masterOffResponse.status.planType, "disabled");
  assert.equal(enableCaptionEvents, enablesBeforeMasterOff);
  assert.equal(disableCaptionEvents, disablesBeforeMasterOff);
});

test("未購買 VIP 時舊設定即使全部開啟也不會執行付費功能", async () => {
  segment.textContent = "我哋软件保存的信息";
  emit("ytlang:player-data", testPlayerData());
  const enablesBefore = enableCaptionEvents;
  let response;

  runtimeMessageListener({
    type: "ytlang:settings-updated",
    vipActive: false,
    settings: {
      ...storedSettings,
      enabled: true,
      simplifiedMode: "youtube",
      embeddedDetection: false,
      taiwanTermsEnabled: true,
      hongKongColloquialEnabled: true,
      customReplacementsEnabled: true,
      customReplacements: [{ from: "軟體", to: "程式", enabled: true }],
      channelRules: [{
        channelId: "channel-1",
        channelName: "測試頻道",
        mode: "force-enable-convert-hk"
      }]
    }
  }, {}, (result) => { response = result; });

  mutationCallback?.([]);
  await settle();
  assert.equal(response.status.channelRuleMode, "");
  assert.notEqual(response.status.planType, "channel-force-enable");
  assert.equal(enableCaptionEvents, enablesBefore);
  assert.equal(segment.textContent, "我哋软件保存的信息");
});
