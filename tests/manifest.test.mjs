import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("OpenCC 不會在預設 YouTube 分頁預先載入", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const isolatedScript = manifest.content_scripts.find((entry) => entry.world !== "MAIN");
  assert.equal(isolatedScript.js.includes("vendor/opencc.js"), false);
  assert.equal(manifest.permissions.includes("scripting"), true);
  assert.equal(manifest.permissions.includes("identity"), true);
  assert.equal(manifest.host_permissions.includes("https://myapp.ahui3c.com/*"), true);
  assert.deepEqual(isolatedScript.js.slice(0, 2), ["src/build-info.js", "src/instance-coordinator.js"]);
  assert.equal(isolatedScript.js[2], "src/platform.js");
});

test("Safari Mac 使用獨立 manifest 並與 Chrome 共用核心", async () => {
  const chromeManifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const safariManifest = JSON.parse(await readFile(new URL("../manifest.safari.json", import.meta.url), "utf8"));
  assert.equal(chromeManifest.minimum_chrome_version, "111");
  assert.equal("minimum_chrome_version" in safariManifest, false);
  assert.equal(safariManifest.browser_specific_settings.safari.strict_min_version, "16.0");
  assert.equal(safariManifest.content_scripts[1].js.join("|"), chromeManifest.content_scripts[1].js.join("|"));
  assert.match(safariManifest.description, /Safari Mac 版的內嵌字幕偵測為實驗性功能/);
});

test("Firefox 使用獨立 manifest、事件背景頁與固定外掛 ID", async () => {
  const chromeManifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const firefoxManifest = JSON.parse(await readFile(new URL("../manifest.firefox.json", import.meta.url), "utf8"));
  assert.deepEqual(firefoxManifest.background.scripts, ["src/build-info.js", "src/instance-coordinator.js", "src/platform.js", "src/background.js"]);
  assert.equal("service_worker" in firefoxManifest.background, false);
  assert.equal(firefoxManifest.browser_specific_settings.gecko.id, "youtube-subtitle-auto-switch@ahui3c.com");
  assert.equal(firefoxManifest.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.deepEqual(firefoxManifest.content_scripts, chromeManifest.content_scripts);
  assert.deepEqual(
    firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required,
    ["personallyIdentifyingInfo", "authenticationInfo", "browsingActivity"]
  );
});

test("Chrome、Firefox 與 Safari 都載入共用實例協調器", async () => {
  const manifests = await Promise.all(["../manifest.json", "../manifest.firefox.json", "../manifest.safari.json"].map(async (path) =>
    JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"))
  ));
  for (const manifest of manifests) {
    const isolatedScript = manifest.content_scripts.find((entry) => entry.js.includes("src/content.js"));
    assert.ok(isolatedScript.js.includes("src/instance-coordinator.js"));
    assert.ok(isolatedScript.js.includes("src/build-info.js"));
  }
});
