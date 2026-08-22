import test from "node:test";
import assert from "node:assert/strict";

let messageListener;
let storageChangeListener;
let activeTabId = 7;
let captureCalls = 0;
let lastIconPath;
let lastTitle;

globalThis.chrome = {
  runtime: {
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
      async get() {
        return { settings: { enabled: true } };
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
      lastIconPath = path;
    },
    async setTitle({ title }) {
      lastTitle = title;
    }
  },
  tabs: {
    async query() {
      return [{ id: activeTabId }];
    },
    async captureVisibleTab(windowId, options) {
      captureCalls += 1;
      assert.equal(windowId, 3);
      assert.deepEqual(options, { format: "png" });
      return "data:image/png;base64,test";
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
});
