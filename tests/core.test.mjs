import test from "node:test";
import assert from "node:assert/strict";
import { Converter } from "opencc-js";

await import("../src/core.js");
const Core = globalThis.YTLangCore;

const translations = [{ languageCode: "zh-Hant", name: "中文（繁體）" }];

test("人工繁體優先於其他字幕", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [
      { languageCode: "en", name: "English", isTranslatable: true },
      { languageCode: "zh-TW", name: "中文（台灣）", isTranslatable: true }
    ],
    translationLanguages: translations
  }, {});
  assert.equal(plan.type, "native");
  assert.equal(plan.track.languageCode, "zh-TW");
});

test("只有簡中時預設使用 YouTube 繁中翻譯", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "zh-Hans", name: "中文（簡體）", isTranslatable: true }],
    translationLanguages: translations
  }, {});
  assert.equal(plan.type, "translate");
});

test("簡中可以改用本機 OpenCC", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "zh-CN", name: "中文（簡體）", isTranslatable: true }],
    translationLanguages: translations
  }, { simplifiedMode: "opencc" });
  assert.equal(plan.type, "opencc");
});

test("預設不使用人工英文、自動英文及其他語言", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "en", name: "English", isTranslatable: true }],
    translationLanguages: translations
  }, {});
  assert.equal(plan.type, "none");
  assert.deepEqual(Core.mergeSettings().disabledRules, ["en-manual", "en-auto", "other"]);
});

test("手動啟用英文規則後仍可翻譯成繁體中文", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "en", name: "English", isTranslatable: true }],
    translationLanguages: translations
  }, { disabledRules: [] });
  assert.equal(plan.type, "translate");
});

test("人工字幕優先於同語言 ASR", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [
      { languageCode: "zh-Hant", kind: "asr", name: "繁中（自動產生）" },
      { languageCode: "zh-Hant", name: "繁中" }
    ],
    translationLanguages: translations
  }, {});
  assert.equal(plan.track.name, "繁中");
});

test("通用 zh 中文字幕會以原生字幕開啟", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "zh", name: "中文", isTranslatable: true }],
    translationLanguages: translations
  }, {});
  assert.equal(plan.type, "native");
  assert.equal(plan.ruleId, "zh-manual");
  assert.equal(plan.track.languageCode, "zh");
});

test("通用 zh 自動字幕可由獨立規則控制", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "zh", name: "中文", isAutomatic: true }],
    translationLanguages: translations
  }, {});
  assert.equal(plan.ruleId, "zh-auto");
});

test("較長的中文腳本代碼仍可正確分類", () => {
  assert.equal(Core.familyOf({ languageCode: "zh-Hant-TW", name: "中文" }), "traditional");
  assert.equal(Core.familyOf({ languageCode: "zh-Hans-CN", name: "中文" }), "simplified");
});

test("停用個別字幕規則後會改用下一個啟用項目", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [
      { languageCode: "zh-Hant", name: "繁中人工字幕" },
      { languageCode: "zh-Hant", kind: "asr", name: "繁中自動字幕" }
    ],
    translationLanguages: translations
  }, { disabledRules: ["trad-manual"] });
  assert.equal(plan.ruleId, "trad-auto");
  assert.equal(plan.track.name, "繁中自動字幕");
});

test("全部規則停用時不選擇任何字幕", () => {
  const plan = Core.chooseCaptionPlan({
    captionTracks: [{ languageCode: "zh-Hant", name: "繁中" }],
    translationLanguages: translations
  }, { disabledRules: Core.RULES.map((rule) => rule.id) });
  assert.equal(plan.type, "none");
  assert.equal(plan.reason, "all-rules-disabled");
});

test("設定合併會排除不存在及重複的停用規則", () => {
  const settings = Core.mergeSettings({ disabledRules: ["en-auto", "unknown", "en-auto"] });
  assert.deepEqual(settings.disabledRules, ["en-auto"]);
});

test("舊設定只遷移一次到新的字幕預設", () => {
  const migrated = Core.migrateStoredSettings({ simplifiedMode: "opencc", disabledRules: [] });
  assert.equal(migrated.settingsVersion, 3);
  assert.equal(migrated.simplifiedMode, "youtube");
  assert.deepEqual(migrated.disabledRules, ["en-manual", "en-auto", "other"]);

  const customized = Core.migrateStoredSettings({
    settingsVersion: 2,
    simplifiedMode: "opencc",
    disabledRules: []
  });
  assert.equal(customized.simplifiedMode, "opencc");
  assert.deepEqual(customized.disabledRules, []);
  assert.equal(customized.taiwanTermsEnabled, true);
  assert.equal(customized.hongKongColloquialEnabled, false);
});

test("OpenCC twp 會同時轉換繁體字與台灣慣用詞", () => {
  const converter = Converter({ from: "cn", to: "twp" });
  assert.equal(converter("保存信息和人工智能软件"), "儲存資訊和人工智慧軟體");
});

test("地區用語只有在本機轉換模式啟用", () => {
  assert.equal(Core.isLocalTextConversionEnabled({ enabled: true, simplifiedMode: "youtube" }), false);
  assert.equal(Core.isLocalTextConversionEnabled({ enabled: true, simplifiedMode: "opencc" }), true);
  assert.equal(Core.isLocalTextConversionEnabled({ enabled: false, simplifiedMode: "opencc" }), false);
});

test("香港常見口語可轉為普通話且較長詞優先", () => {
  assert.equal(
    Core.applyHongKongColloquial("我哋而家唔知道佢哋去咗邊度"),
    "我們現在不知道他們去了哪裡"
  );
  assert.equal(Core.applyHongKongColloquial("唔使客氣，等陣一齊食飯"), "不用客氣，等一下一起吃飯");
});

test("自訂替換可停用並由較長原詞優先套用", () => {
  const rules = [
    { from: "出租車", to: "計程車", enabled: true },
    { from: "出租", to: "租賃", enabled: true },
    { from: "影片", to: "視頻", enabled: false }
  ];
  assert.equal(Core.applyLiteralReplacements("搭出租車看影片", rules), "搭計程車看影片");
});

test("自訂替換會排除空白、重複及無效規則", () => {
  assert.deepEqual(Core.normalizeReplacementRules([
    { from: " A ", to: " B " },
    { from: "A", to: "C" },
    { from: "", to: "D" },
    { from: "E", to: "E" }
  ]), [{ from: "A", to: "B", enabled: true }]);
});

test("舊版優先順序會在繁中之後插入新增的中文字幕規則", () => {
  const oldPriority = [
    "trad-manual", "trad-auto", "simp-manual", "simp-auto", "en-manual", "en-auto", "other"
  ];
  const settings = Core.mergeSettings({ priority: oldPriority });
  assert.deepEqual(settings.priority.slice(0, 6), [
    "trad-manual", "trad-auto", "zh-manual", "zh-auto", "simp-manual", "simp-auto"
  ]);
});

test("忽略只有音樂符號或音效標記的 cue", () => {
  assert.equal(Core.isUsefulCue("♪♪"), false);
  assert.equal(Core.isUsefulCue("[Music]"), false);
  assert.equal(Core.isUsefulCue("這是一段字幕"), true);
});

test("內嵌字幕最早可在第三個 cue 判定成功", () => {
  const pending = Core.evaluateEmbeddedSamples([
    { score: 0.9, hash: "a", bandCenter: 0.72 },
    { score: 0.85, hash: "b", bandCenter: 0.74 }
  ]);
  assert.equal(pending.decision, "pending");

  const detected = Core.evaluateEmbeddedSamples([
    { score: 0.9, hash: "a", bandCenter: 0.72 },
    { score: 0.85, hash: "b", bandCenter: 0.74 },
    { score: 0.82, hash: "c", bandCenter: 0.71 }
  ]);
  assert.equal(detected.decision, "detected");
});

function image(width, height, color = [26, 32, 38]) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  }
  return pixels;
}

function pixel(pixels, width, x, y, color) {
  const offset = (y * width + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
}

function drawBlockSubtitle(pixels, width, height, color = [245, 245, 245]) {
  const baseline = Math.round(height * 0.76);
  const startX = Math.round(width * 0.18);
  for (let glyph = 0; glyph < 14; glyph += 1) {
    const x0 = startX + glyph * 14;
    for (let y = baseline - 9; y <= baseline + 9; y += 1) {
      for (let x = x0; x <= x0 + 8; x += 1) {
        const border = x === x0 || x === x0 + 8 || y === baseline - 9 || y === baseline + 9;
        const stroke = x === x0 + 4 || y === baseline || (glyph % 2 === 0 && x - x0 === y - baseline + 9);
        if (border) pixel(pixels, width, x, y, [0, 0, 0]);
        else if (stroke) pixel(pixels, width, x, y, color);
      }
    }
  }
}

test("底部圖形字幕會產生可判定的文字帶分數", () => {
  const width = 320;
  const height = 180;
  const pixels = image(width, height);
  drawBlockSubtitle(pixels, width, height);
  const result = Core.analyzeBottomTextBand(pixels, width, height);
  assert.ok(result.score >= 0.5, `score=${result.score}`);
  assert.ok(result.bandCenter > 0.55, `bandCenter=${result.bandCenter}`);
});

test("彩色底部字幕也能透過色彩邊緣偵測", () => {
  const width = 320;
  const height = 180;
  const pixels = image(width, height, [72, 72, 72]);
  drawBlockSubtitle(pixels, width, height, [0, 150, 210]);
  const result = Core.analyzeBottomTextBand(pixels, width, height);
  assert.ok(result.score >= 0.45, `score=${result.score}`);
});

test("平滑的底部畫面不應被判定為字幕", () => {
  const width = 320;
  const height = 180;
  const pixels = image(width, height);
  for (let y = 0; y < height; y += 1) {
    const shade = Math.round(20 + (y / height) * 80);
    for (let x = 0; x < width; x += 1) pixel(pixels, width, x, y, [shade, shade, shade]);
  }
  const result = Core.analyzeBottomTextBand(pixels, width, height);
  assert.ok(result.score < 0.2, `score=${result.score}`);
});

test("整片規律紋理不能只因邊緣很多就被判定為字幕", () => {
  const width = 320;
  const height = 180;
  const pixels = image(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const shade = (Math.floor(x / 5) + Math.floor(y / 5)) % 2 ? 210 : 35;
      pixel(pixels, width, x, y, [shade, shade, shade]);
    }
  }
  const result = Core.analyzeBottomTextBand(pixels, width, height);
  assert.ok(result.score < 0.5, `score=${result.score}`);
});

test("CC 遮罩會以左右鄰近像素平滑填補而非留下高對比字幕", () => {
  const width = 12;
  const height = 4;
  const pixels = image(width, height, [30, 30, 30]);
  for (let y = 1; y < 3; y += 1) {
    for (let x = 4; x < 8; x += 1) pixel(pixels, width, x, y, [255, 255, 255]);
  }
  Core.maskPixelRegions(pixels, width, height, [{ x: 4, y: 1, width: 4, height: 2 }]);
  for (let y = 1; y < 3; y += 1) {
    for (let x = 4; x < 8; x += 1) {
      const offset = (y * width + x) * 4;
      assert.equal(pixels[offset], 30);
    }
  }
});
