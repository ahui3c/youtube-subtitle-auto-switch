import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");
const html = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");
const js = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");

test("YouTube 翻譯模式會讓鎖定功能的標題與自訂替換開關變暗", () => {
  assert.match(css, /\.terms-section\.is-locked \.feature-title-row h2,\s*\.custom-section\.is-locked \.feature-title-row h2\s*\{\s*color:\s*#718593;\s*\}/);
  assert.match(css, /\.custom-section\.is-locked > \.section-heading \.inline-switch,\s*\.custom-section\.is-vip-locked > \.section-heading \.inline-switch,\s*\.cloud-sync-section\.is-vip-locked > \.section-heading \.inline-switch\s*\{\s*opacity:\s*\.48;\s*\}/);
});

test("沒有 VIP 權限時自訂詞彙主開關顯示為關閉且不可操作", () => {
  assert.match(js, /customReplacementsEnabled\.checked\s*=\s*settings\.customReplacementsEnabled\s*&&\s*localMode\s*&&\s*vipActive;/);
  assert.match(js, /customReplacementsEnabled\.disabled\s*=\s*!localMode\s*\|\|\s*!vipActive;/);
  assert.match(js, /customSection\.setAttribute\("aria-disabled",\s*String\(!localMode\s*\|\|\s*!vipActive\)\);/);
});

test("沒有 VIP 權限時三個 VIP 模組都呈現關閉與鎖定狀態", () => {
  assert.match(js, /taiwanTermsEnabled\.checked\s*=\s*settings\.taiwanTermsEnabled\s*&&\s*localMode\s*&&\s*vipActive;/);
  assert.match(js, /hongKongColloquialEnabled\.checked\s*=\s*settings\.hongKongColloquialEnabled\s*&&\s*localMode\s*&&\s*vipActive;/);
  assert.match(js, /channelRulesSection\.classList\.toggle\("is-vip-locked",\s*!vipActive\);/);
  assert.match(js, /channelRulesSection\.setAttribute\("aria-disabled",\s*String\(!vipActive\)\);/);
});

test("插件提供選用的 VIP 雲端同步與衝突處理操作", () => {
  assert.match(html, /id="cloud-sync-enabled"/);
  assert.match(html, /id="cloud-sync-use-local"/);
  assert.match(html, /id="cloud-sync-use-cloud"/);
  assert.match(js, /ytlang:cloud-sync-enable/);
  assert.match(js, /ytlang:cloud-sync-local-changed/);
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

test("Safari Mac 會在 OCR 模組顯示實驗性說明", () => {
  assert.match(html, /id="safari-detector-note"[^>]*hidden/);
  assert.match(html, /Safari Mac 實驗性/);
  assert.match(js, /safariDetectorNote\.hidden\s*=\s*!Platform\.isSafari/);
  assert.match(css, /\.platform-note\s*\{/);
});

test("VIP 登入區塊位於免費功能之後與第一個 VIP 功能之前", () => {
  const conversionIndex = html.indexOf('id="conversion-title"');
  const accountIndex = html.indexOf('id="vip-account"');
  const termsIndex = html.indexOf('id="terms-section"');
  assert.ok(accountIndex > conversionIndex);
  assert.ok(termsIndex > accountIndex);
  assert.equal(html.match(/id="vip-account"/g)?.length, 1);
});

test("一般模組與 VIP 帳號模組共用一致的卡片間距與尺寸規則", () => {
  assert.match(css, /--card-gap:\s*12px;/);
  assert.match(css, /--card-radius:\s*12px;/);
  assert.match(css, /\.section\s*\{[^}]*border-radius:\s*var\(--card-radius\);[^}]*margin-top:\s*var\(--card-gap\);[^}]*padding:\s*var\(--card-padding\);/s);
  assert.match(css, /\.vip-account\s*\{[^}]*background:\s*var\(--panel\);[^}]*border-radius:\s*var\(--card-radius\);[^}]*margin:\s*var\(--card-gap\) 0 0;[^}]*padding:\s*var\(--compact-card-padding\);/s);
});

test("面板使用新的全自動簡轉繁與台灣用語顯示名稱", () => {
  assert.match(html, /<h2 id="conversion-title">全自動簡轉繁<\/h2>/);
  assert.match(html, /role="radiogroup" aria-label="全自動簡轉繁"/);
  assert.match(html, /<strong>使用台灣用語顯示<\/strong>/);
  assert.match(html, /id="taiwanTermsEnabled"[^>]+aria-label="使用台灣用語顯示"/);
});

test("簡繁轉換範圍提供三個互斥選項", () => {
  assert.match(html, /name="chineseConversionScope" value="confirmed"/);
  assert.match(html, /僅處理確認簡體字幕/);
  assert.match(html, /name="chineseConversionScope" value="unspecified"/);
  assert.match(html, /未定義簡繁中文強制轉換/);
  assert.match(html, /name="chineseConversionScope" value="all"/);
  assert.match(html, /全部中文強制轉換/);
  assert.match(js, /settings\.chineseConversionScope/);
  assert.match(js, /querySelectorAll\('input\[name="chineseConversionScope"\]'\)/);
});

test("一般 checked 樣式不會替中文範圍選項文字加上整片色塊", () => {
  assert.doesNotMatch(css, /(?:^|\n)input:checked \+ span\s*\{/);
  assert.match(css, /\.conversion-scope-option span\s*\{[^}]*background:\s*transparent;/s);
});

test("指定頻道規則依序顯示五種選項", () => {
  for (const label of [
    "停用全部功能",
    "強制開啟字幕",
    "強制關閉字幕",
    "強制開啟字幕 \\+ 簡繁轉換",
    "強制開啟字幕 \\+ 簡繁粵語轉換"
  ]) assert.match(js, new RegExp(label));
  for (const oldLabel of ["略過 OCR 字幕辨識", "強制 OCR 字幕辨識", "強置關閉字幕"]) {
    assert.doesNotMatch(js, new RegExp(oldLabel));
  }
  assert.ok(js.indexOf('"force-enable-no-ocr": "強制開啟字幕"') < js.indexOf('"force-disable-no-ocr": "強制關閉字幕"'));
});

test("VIP 功能可由 24 小時試用或購買授權解除鎖定", () => {
  assert.match(html, /id="vip-login"/);
  assert.match(html, /登入可試用 VIP 24 小時；試用或購買生效後即可使用地區用語轉換/);
  assert.match(html, /登入可試用 VIP 24 小時；試用或購買生效後即可使用自訂詞彙替換/);
  assert.match(html, /登入可試用 VIP 24 小時；試用或購買生效後即可使用指定頻道規則/);
  assert.match(js, /vipEntitlement\.vipActive === true/);
  assert.match(css, /\.is-vip-locked/);
});

test("Google 登入按鍵會顯示啟動中與背景錯誤", () => {
  assert.match(js, /正在開啟 Google 登入視窗/);
  assert.match(js, /插件背景程序無法回應/);
  assert.match(js, /vipAuthNotice/);
});

test("插件提供登入後前往網站填寫的問題回報入口", () => {
  assert.match(html, /id="open-feedback"/);
  assert.match(html, /Bug、影片問題、新功能建議或其他意見/);
  assert.match(js, /ytlang:open-feedback/);
  assert.match(js, /videoUrl:\s*activeTab\?\.url/);
  assert.match(css, /\.feedback-section\s*\{/);
});
