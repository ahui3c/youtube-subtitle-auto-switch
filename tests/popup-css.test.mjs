import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");
const html = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");
const js = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");

test("YouTube 翻譯模式會讓鎖定功能的標題與自訂替換開關變暗", () => {
  assert.match(css, /\.terms-section\.is-locked \.feature-title-row h2,\s*\.custom-section\.is-locked \.feature-title-row h2\s*\{\s*color:\s*#718593;\s*\}/);
  assert.match(css, /\.custom-section\.is-locked > \.section-heading \.inline-switch\s*\{\s*opacity:\s*\.48;\s*\}/);
});

test("圖形 OCR 模組位於字幕優先順序與全自動簡轉繁之間", () => {
  const priorityIndex = html.indexOf('id="priority-title"');
  const detectorIndex = html.indexOf('id="detector-title"');
  const conversionIndex = html.indexOf('id="conversion-title"');
  assert.ok(priorityIndex >= 0);
  assert.ok(detectorIndex > priorityIndex);
  assert.ok(conversionIndex > detectorIndex);
  assert.equal(html.match(/id="detector-title"/g)?.length, 1);
});

test("面板使用新的全自動簡轉繁與台灣用語顯示名稱", () => {
  assert.match(html, /<h2 id="conversion-title">全自動簡轉繁<\/h2>/);
  assert.match(html, /role="radiogroup" aria-label="全自動簡轉繁"/);
  assert.match(html, /<strong>使用台灣用語顯示<\/strong>/);
  assert.match(html, /id="taiwanTermsEnabled"[^>]+aria-label="使用台灣用語顯示"/);
});

test("指定頻道規則顯示五種完整選項", () => {
  for (const label of [
    "停用全部",
    "略過 OCR 字幕辨識",
    "強制 OCR 字幕辨識",
    "強置開啟字幕，不 OCR 偵測",
    "強置關閉字幕，不 OCR 偵測"
  ]) assert.match(js, new RegExp(label));
});
