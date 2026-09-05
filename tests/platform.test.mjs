import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/platform.js", import.meta.url), "utf8");

function loadPlatform({ runtimeUrl, userAgent = "" }) {
  const context = {
    navigator: { userAgent },
    chrome: {
      runtime: { getURL: () => runtimeUrl },
      tabs: { captureVisibleTab() {} },
      identity: { getRedirectURL() {}, launchWebAuthFlow() {} }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.YTLangPlatform;
}

test("Chrome 平台維持正式內嵌字幕偵測路徑", () => {
  const platform = loadPlatform({ runtimeUrl: "chrome-extension://extension-id/" });
  assert.equal(platform.target, "chrome");
  assert.equal(platform.isChrome, true);
  assert.equal(platform.capabilities.embeddedSubtitleDetection.experimental, false);
});

test("Safari Mac 將內嵌字幕偵測標示為實驗性", () => {
  const platform = loadPlatform({ runtimeUrl: "safari-web-extension://temporary-id/" });
  assert.equal(platform.target, "safari-macos");
  assert.equal(platform.isSafari, true);
  assert.equal(platform.capabilities.embeddedSubtitleDetection.available, true);
  assert.equal(platform.capabilities.embeddedSubtitleDetection.experimental, true);
});

test("Firefox 使用獨立平台識別且保留正式字幕處理路徑", () => {
  const platform = loadPlatform({
    runtimeUrl: "moz-extension://temporary-id/",
    userAgent: "Mozilla/5.0 Firefox/155.0"
  });
  assert.equal(platform.target, "firefox");
  assert.equal(platform.isFirefox, true);
  assert.equal(platform.isChrome, false);
  assert.equal(platform.isSafari, false);
  assert.equal(platform.capabilities.embeddedSubtitleDetection.available, true);
  assert.equal(platform.capabilities.embeddedSubtitleDetection.experimental, false);
});

test("Microsoft Edge 使用獨立平台識別但維持 Chromium 功能路徑", () => {
  const platform = loadPlatform({
    runtimeUrl: "chrome-extension://extension-id/",
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0"
  });
  assert.equal(platform.target, "edge");
  assert.equal(platform.isEdge, true);
  assert.equal(platform.isChrome, false);
  assert.equal(platform.isFirefox, false);
  assert.equal(platform.isSafari, false);
  assert.equal(platform.capabilities.embeddedSubtitleDetection.experimental, false);
});
