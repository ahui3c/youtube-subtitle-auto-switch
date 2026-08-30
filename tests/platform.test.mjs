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
