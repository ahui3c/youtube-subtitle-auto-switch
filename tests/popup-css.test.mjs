import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");

test("YouTube 翻譯模式會讓鎖定功能的標題與自訂替換開關變暗", () => {
  assert.match(css, /\.terms-section\.is-locked \.feature-title-row h2,\s*\.custom-section\.is-locked \.feature-title-row h2\s*\{\s*color:\s*#718593;\s*\}/);
  assert.match(css, /\.custom-section\.is-locked > \.section-heading \.inline-switch\s*\{\s*opacity:\s*\.48;\s*\}/);
});
