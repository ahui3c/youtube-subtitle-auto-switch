import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/instance-coordinator.js", import.meta.url), "utf8");

function coordinator() {
  const context = {};
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.YTLangInstanceCoordinator;
}

test("協調器會依語意版本選擇較新的插件", () => {
  const value = coordinator();
  const oldInstance = { extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", version: "0.5.9" };
  const newInstance = { extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", version: "0.10.0" };
  assert.equal(value.compareVersions("0.10.0", "0.5.9"), 1);
  assert.equal(value.preferredInstance(oldInstance, newInstance), newInstance);
});

test("相同版本會讓開發版優先於 Chrome 商店版", () => {
  const value = coordinator();
  const store = { extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", version: "0.5.0", distribution: "chrome-web-store" };
  const development = { extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", version: "0.5.0", distribution: "development" };
  assert.equal(value.preferredInstance(store, development), development);
  assert.equal(value.preferredInstance(development, store), development);
});

test("以正式 Chrome 商店 ID 辨識實際安裝來源", () => {
  const value = coordinator();
  assert.equal(
    value.classifyDistribution("akcaiofhidblmchmmakfmhdjfhcglhig", "chrome-web-store"),
    "chrome-web-store"
  );
  assert.equal(
    value.classifyDistribution("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "chrome-web-store"),
    "development"
  );
});

test("相同版本與發行身分會依固定插件 ID 規則只保留一個實例", () => {
  const value = coordinator();
  const first = { extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", version: "0.5.0", distribution: "development" };
  const second = { extensionId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", version: "0.5.0", distribution: "development" };
  assert.equal(value.preferredInstance(second, first), first);
  assert.equal(value.preferredInstance(first, second), first);
});

test("插件 ID 必須符合 Chromium 的固定格式", () => {
  const value = coordinator();
  assert.equal(value.validExtensionId("abcdefghijklmnopabcdefghijklmnop"), true);
  assert.equal(value.validExtensionId("fake-extension"), false);
});

test("頁面橋接只允許一個新版實例註冊播放器監聽", async () => {
  const bridge = await readFile(new URL("../src/page-bridge.js", import.meta.url), "utf8");
  assert.match(bridge, /__YTLANG_PAGE_BRIDGE_ACTIVE__/);
});

test("衝突停用不會改寫使用者原本的總開關設定", async () => {
  const background = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
  const content = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
  assert.match(background, /let instanceConflict = null/);
  assert.match(background, /effectiveEnabled = enabled && !instanceConflict\?\.active/);
  assert.match(content, /suspendForInstanceConflict/);
  assert.doesNotMatch(content, /settings\.enabled\s*=\s*false/);
});
