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
  settingsVersion: 5,
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
        callback({ customReplacements: [], channelRules: [] });
      },
      set(value) {
        if (value.status) localStatusWrites += 1;
        return Promise.resolve();
      }
    }
  }
};

await import("../src/content.js");

function emit(type, detail) {
  document.dispatchEvent(new CustomEvent(type, { detail }));
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

test("本機轉換、字幕監聽生命週期與狀態去重可共同運作", async () => {
  await settle();
  const player = {
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
