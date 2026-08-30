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
  assert.equal(isolatedScript.js[0], "src/platform.js");
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
