(function initCore(global) {
  "use strict";

  const RULES = Object.freeze([
    { id: "trad-manual", label: "中文繁體字幕", family: "traditional", automatic: false, action: "native" },
    { id: "zh-manual", label: "中文字幕", family: "chinese", automatic: false, action: "native" },
    { id: "simp-manual", label: "中文簡體字幕", family: "simplified", automatic: false, action: "simplified" },
    { id: "en-manual", label: "英文字幕", family: "english", automatic: false, action: "translate" },
    { id: "en-auto", label: "自動產生的英文字幕", family: "english", automatic: true, action: "translate" },
    { id: "other", label: "其他可翻譯語言字幕", family: "other", automatic: null, action: "translate" }
  ]);

  const SETTINGS_VERSION = 5;
  const DEFAULT_DISABLED_RULES = Object.freeze(["en-manual", "en-auto", "other"]);
  const CHANNEL_RULE_MODES = Object.freeze(["disabled", "skip-ocr", "force-ocr"]);

  // Curated conservative mappings only. Ambiguous single-character replacements
  // are deliberately excluded because they can corrupt names and formal Chinese.
  const HONG_KONG_COLLOQUIAL_RULES = Object.freeze([
    ["唔使客氣", "不用客氣"], ["唔好意思", "不好意思"], ["唔緊要", "沒關係"],
    ["冇乜所謂", "沒什麼關係"], ["冇所謂", "沒關係"], ["對唔住", "對不起"],
    ["唔該晒", "非常感謝"], ["多謝晒", "非常感謝"], ["唔該你", "麻煩你"],
    ["做緊乜嘢", "正在做什麼"], ["做緊乜", "正在做什麼"], ["發生咩事", "發生什麼事"],
    ["發生乜嘢事", "發生什麼事"], ["去咗邊度", "去了哪裡"], ["去邊度", "去哪裡"],
    ["喺邊度", "在哪裡"], ["有冇問題", "有沒有問題"], ["有冇時間", "有沒有時間"],
    ["使唔使", "需不需要"], ["可唔可以", "可不可以"], ["得唔得", "行不行"],
    ["好唔好", "好不好"], ["係唔係", "是不是"], ["係咪", "是不是"],
    ["唔知道", "不知道"], ["唔明白", "不明白"], ["唔需要", "不需要"],
    ["唔可以", "不可以"], ["唔可能", "不可能"], ["唔一定", "不一定"],
    ["唔記得", "不記得"], ["唔同意", "不同意"], ["唔鍾意", "不喜歡"],
    ["唔想要", "不想要"], ["唔會再", "不會再"], ["唔係咁", "不是這樣"],
    ["唔係", "不是"], ["唔會", "不會"], ["唔好", "不要"],
    ["冇問題", "沒問題"], ["冇辦法", "沒辦法"], ["冇時間", "沒時間"],
    ["冇機會", "沒機會"], ["冇可能", "不可能"], ["冇需要", "沒必要"],
    ["而家先", "現在才"], ["依家先", "現在才"], ["而家", "現在"], ["依家", "現在"],
    ["點解會", "為什麼會"], ["點解", "為什麼"], ["點樣做", "怎麼做"], ["點樣", "怎麼樣"],
    ["點算好", "怎麼辦才好"], ["點算", "怎麼辦"], ["邊一個", "哪一個"], ["邊個", "誰"],
    ["邊一度", "哪裡"], ["邊度", "哪裡"], ["幾時", "什麼時候"], ["乜嘢", "什麼"],
    ["咩意思", "什麼意思"], ["咩事", "什麼事"], ["呢一個", "這一個"], ["呢個", "這個"],
    ["嗰一個", "那一個"], ["嗰個", "那個"], ["呢一啲", "這一些"], ["呢啲", "這些"],
    ["嗰一啲", "那一些"], ["嗰啲", "那些"], ["我哋", "我們"], ["你哋", "你們"],
    ["佢哋", "他們"], ["大家一齊", "大家一起"], ["一齊去", "一起去"], ["一齊", "一起"],
    ["等一陣間", "等一下"], ["一陣間", "一會兒"], ["等陣", "等一下"], ["陣間", "待會兒"],
    ["頭先", "剛才"], ["啱啱", "剛剛"], ["即刻", "立刻"], ["後尾", "後來"],
    ["聽日", "明天"], ["尋日", "昨天"], ["琴日", "昨天"], ["今朝", "今天早上"],
    ["朝早", "早上"], ["晏晝", "下午"], ["夜晚", "晚上"], ["返工", "上班"],
    ["收工", "下班"], ["放工", "下班"], ["搵工", "找工作"], ["搵人", "找人"],
    ["搵錢", "賺錢"], ["屋企人", "家人"], ["返屋企", "回家"], ["屋企", "家裡"],
    ["沖涼", "洗澡"], ["行街", "逛街"], ["食飯", "吃飯"], ["買嘢", "買東西"],
    ["做嘢", "做事"], ["講嘢", "說話"], ["睇影片", "看影片"], ["睇片", "看影片"],
    ["睇下", "看一下"], ["睇到", "看到"], ["睇唔到", "看不到"], ["聽唔到", "聽不到"],
    ["入嚟", "進來"], ["出嚟", "出來"], ["返嚟", "回來"], ["過嚟", "過來"],
    ["落嚟", "下來"], ["上嚟", "上來"], ["搞掂", "搞定"], ["未搞掂", "還沒完成"],
    ["淨係", "只是"], ["剩係", "只是"], ["梗係", "當然"], ["即係話", "也就是說"],
    ["即係", "就是"], ["諗住", "打算"], ["諗下", "想想"], ["諗到", "想到"],
    ["鍾意", "喜歡"], ["應承", "答應"], ["求其", "隨便"], ["是但", "隨便"],
    ["無端端", "無緣無故"], ["得閒", "有空"], ["仲有", "還有"], ["仲未", "還沒"],
    ["咁樣", "這樣"], ["咁多", "這麼多"], ["咁快", "這麼快"], ["咁耐", "這麼久"],
    ["咁遠", "這麼遠"], ["咁近", "這麼近"], ["咁大", "這麼大"], ["咁細", "這麼小"],
    ["好攰", "很累"], ["好正", "很棒"], ["好抵", "很划算"], ["平啲", "便宜一點"],
    ["快啲", "快一點"], ["慢啲", "慢一點"], ["早啲", "早一點"], ["遲啲", "晚一點"],
    ["小心啲", "小心一點"], ["雪櫃", "冰箱"], ["手提電話", "手機"], ["流動電話", "手機"],
    ["電郵地址", "電子郵件地址"], ["電郵", "電子郵件"], ["的士", "出租車"], ["巴士", "公共汽車"]
  ].map(([from, to], priority) => Object.freeze({ from, to, enabled: true, priority })));
  const replacementRulesCache = new WeakMap();

  const DEFAULT_SETTINGS = Object.freeze({
    settingsVersion: SETTINGS_VERSION,
    enabled: true,
    autoEnableCaptions: true,
    simplifiedMode: "youtube",
    embeddedDetection: true,
    skipEmbeddedDetectionForSimplifiedOnly: false,
    taiwanTermsEnabled: true,
    hongKongColloquialEnabled: false,
    customReplacementsEnabled: true,
    customReplacements: [],
    channelRules: [],
    priority: RULES.map((rule) => rule.id),
    disabledRules: DEFAULT_DISABLED_RULES
  });

  const TRADITIONAL_CODES = new Set(["zh-hant", "zh-tw", "zh-hk", "zh-mo"]);
  const SIMPLIFIED_CODES = new Set(["zh-hans", "zh-cn", "zh-sg"]);
  const ENGLISH_CODES = new Set(["en", "en-us", "en-gb", "en-ca", "en-au"]);

  function normalizeLanguageCode(value) {
    return String(value || "").trim().replace(/_/g, "-").toLowerCase();
  }

  function isAutomatic(track) {
    return track?.isAutomatic === true
      || track?.kind === "asr"
      || String(track?.vssId || "").startsWith("a.");
  }

  function familyOf(track) {
    const code = normalizeLanguageCode(track?.languageCode);
    const name = String(track?.name || "").toLowerCase();
    if (TRADITIONAL_CODES.has(code) || code.startsWith("zh-hant-") || /繁體|繁体|traditional/.test(name)) {
      return "traditional";
    }
    if (SIMPLIFIED_CODES.has(code) || code.startsWith("zh-hans-") || /簡體|简体|simplified/.test(name)) {
      return "simplified";
    }
    if (code === "zh" || code.startsWith("zh-") || /中文|chinese/.test(name)) return "chinese";
    if (ENGLISH_CODES.has(code) || code.startsWith("en-")) return "english";
    return "other";
  }

  function ruleMatches(rule, track) {
    if (!rule || !track || familyOf(track) !== rule.family) return false;
    return rule.automatic === null || rule.automatic === isAutomatic(track);
  }

  function mergeSettings(settings) {
    const input = settings && typeof settings === "object" ? settings : {};
    const knownIds = new Set(RULES.map((rule) => rule.id));
    const supplied = Array.isArray(input.priority)
      ? [...new Set(input.priority.filter((id) => knownIds.has(id)))]
      : [];
    const priority = supplied.length ? [...supplied] : RULES.map((rule) => rule.id);
    for (const rule of RULES) {
      if (priority.includes(rule.id)) continue;
      const canonicalIndex = RULES.findIndex((candidate) => candidate.id === rule.id);
      let insertionIndex = 0;
      for (let index = canonicalIndex - 1; index >= 0; index -= 1) {
        const previousIndex = priority.indexOf(RULES[index].id);
        if (previousIndex >= 0) {
          insertionIndex = previousIndex + 1;
          break;
        }
      }
      priority.splice(insertionIndex, 0, rule.id);
    }
    const disabledRules = Array.isArray(input.disabledRules)
      ? [...new Set(input.disabledRules.filter((id) => knownIds.has(id)))]
      : [...DEFAULT_DISABLED_RULES];
    return {
      ...DEFAULT_SETTINGS,
      ...input,
      settingsVersion: SETTINGS_VERSION,
      simplifiedMode: input.simplifiedMode === "opencc" ? "opencc" : "youtube",
      skipEmbeddedDetectionForSimplifiedOnly: input.skipEmbeddedDetectionForSimplifiedOnly === true,
      taiwanTermsEnabled: input.taiwanTermsEnabled !== false,
      hongKongColloquialEnabled: input.hongKongColloquialEnabled === true,
      customReplacementsEnabled: input.customReplacementsEnabled !== false,
      customReplacements: normalizeReplacementRules(input.customReplacements).slice(0, 100),
      channelRules: normalizeChannelRules(input.channelRules).slice(0, 200),
      priority,
      disabledRules
    };
  }

  function migrateStoredSettings(settings) {
    const input = settings && typeof settings === "object" ? settings : {};
    if (Number(input.settingsVersion) >= SETTINGS_VERSION) return mergeSettings(input);
    if (Number(input.settingsVersion) >= 2) {
      return mergeSettings({ ...input, settingsVersion: SETTINGS_VERSION });
    }
    const disabledRules = [...new Set([
      ...DEFAULT_DISABLED_RULES,
      ...(Array.isArray(input.disabledRules) ? input.disabledRules : [])
    ])];
    return mergeSettings({
      ...input,
      settingsVersion: SETTINGS_VERSION,
      simplifiedMode: "youtube",
      disabledRules
    });
  }

  function normalizeReplacementRules(rules) {
    if (!Array.isArray(rules)) return [];
    const normalized = [];
    const seen = new Set();
    for (const candidate of rules) {
      const from = String(candidate?.from || "").trim().slice(0, 80);
      const to = String(candidate?.to || "").trim().slice(0, 80);
      if (!from || !to || from === to || seen.has(from)) continue;
      seen.add(from);
      normalized.push({ from, to, enabled: candidate?.enabled !== false });
    }
    return normalized;
  }

  function normalizeChannelRules(rules) {
    if (!Array.isArray(rules)) return [];
    const normalized = [];
    const seen = new Set();
    for (const candidate of rules) {
      const channelId = String(candidate?.channelId || "").trim().slice(0, 100);
      if (!channelId || seen.has(channelId)) continue;
      seen.add(channelId);
      const channelName = String(candidate?.channelName || "").trim().slice(0, 100) || "未命名頻道";
      const mode = CHANNEL_RULE_MODES.includes(candidate?.mode) ? candidate.mode : "skip-ocr";
      normalized.push({ channelId, channelName, mode });
    }
    return normalized;
  }

  function channelRuleFor(playerData, rawSettings) {
    const channelId = String(playerData?.channelId || "").trim();
    if (!channelId) return null;
    const settings = mergeSettings(rawSettings);
    return settings.channelRules.find((rule) => rule.channelId === channelId) || null;
  }

  function applyLiteralReplacements(value, rules) {
    let result = String(value || "");
    if (!Array.isArray(rules)) return result;
    let ordered = replacementRulesCache.get(rules);
    if (!ordered) {
      ordered = normalizeReplacementRules(rules)
        .map((rule, index) => ({ ...rule, index }))
        .filter((rule) => rule.enabled)
        .sort((left, right) => right.from.length - left.from.length || left.index - right.index);
      replacementRulesCache.set(rules, ordered);
    }
    for (const rule of ordered) result = result.split(rule.from).join(rule.to);
    return result;
  }

  function applyHongKongColloquial(value) {
    return applyLiteralReplacements(value, HONG_KONG_COLLOQUIAL_RULES);
  }

  function isLocalTextConversionEnabled(settings) {
    return settings?.enabled !== false && settings?.simplifiedMode === "opencc";
  }

  function shouldApplyCustomReplacements(settings) {
    return isLocalTextConversionEnabled(settings) && settings?.customReplacementsEnabled !== false;
  }

  function shouldMonitorCaptions(settings, state = {}) {
    if (state.documentHidden || settings?.enabled === false || !state.hasVideo || !state.hasCaptionTracks) {
      return false;
    }
    if (state.planType === "channel-disabled") return false;
    const needsLocalConversion = isLocalTextConversionEnabled(settings);
    const needsEmbeddedDetection = state.captureArmed === true && state.detectionComplete !== true;
    return needsLocalConversion || needsEmbeddedDetection;
  }

  function findTraditionalTarget(translationLanguages) {
    const languages = Array.isArray(translationLanguages) ? translationLanguages : [];
    const priorities = ["zh-hant", "zh-tw", "zh-hk"];
    for (const wanted of priorities) {
      const found = languages.find((language) => normalizeLanguageCode(language.languageCode) === wanted);
      if (found) return found;
    }
    return null;
  }

  function chooseCaptionPlan(playerData, rawSettings) {
    const settings = mergeSettings(rawSettings);
    if (!settings.enabled) return { type: "disabled", reason: "extension-disabled" };

    const tracks = Array.isArray(playerData?.captionTracks) ? playerData.captionTracks : [];
    if (!tracks.length) return { type: "none", reason: "no-caption-tracks" };

    const disabledRules = new Set(settings.disabledRules);
    const rules = settings.priority
      .filter((id) => !disabledRules.has(id))
      .map((id) => RULES.find((rule) => rule.id === id))
      .filter(Boolean);

    if (!rules.length) return { type: "none", reason: "all-rules-disabled" };

    for (const rule of rules) {
      const track = tracks.find((candidate) => ruleMatches(rule, candidate));
      if (!track) continue;

      if (rule.action === "native") {
        return { type: "native", ruleId: rule.id, track };
      }

      if (rule.action === "simplified" && settings.simplifiedMode === "opencc") {
        return { type: "opencc", ruleId: rule.id, track };
      }

      const target = findTraditionalTarget(playerData.translationLanguages);
      if (track.isTranslatable !== false && target) {
        return { type: "translate", ruleId: rule.id, track, target };
      }

      if (rule.action === "simplified") {
        return { type: "native", ruleId: rule.id, track, warning: "traditional-target-unavailable" };
      }
    }

    return { type: "none", reason: "no-matching-rule" };
  }

  function embeddedDetectionSkipReason(playerData, rawSettings) {
    const settings = mergeSettings(rawSettings);
    const channelId = String(playerData?.channelId || "").trim();
    const channelRule = settings.channelRules.find((rule) => rule.channelId === channelId);
    if (channelRule?.mode === "disabled") return "channel-disabled";
    if (!settings.embeddedDetection) return "";
    const tracks = Array.isArray(playerData?.captionTracks) ? playerData.captionTracks : [];
    if (!tracks.length) return "no-caption-tracks";
    if (channelRule?.mode === "skip-ocr") return "channel-skip-ocr";
    if (channelRule?.mode === "force-ocr") return "";
    if (!settings.skipEmbeddedDetectionForSimplifiedOnly) return "";
    const families = new Set(tracks.map(familyOf));
    return families.has("simplified") && !families.has("traditional") ? "simplified-only" : "";
  }

  function normalizeCueText(value) {
    return String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isUsefulCue(value) {
    const text = normalizeCueText(value);
    if (!text || /^(?:[♪♫♬]+|[\[(（【].{0,18}[\])）】])$/u.test(text)) return false;
    const cjkCount = (text.match(/[\u3400-\u9FFF]/gu) || []).length;
    const latinCount = (text.match(/[A-Za-z]/g) || []).length;
    return cjkCount >= 2 || latinCount >= 4 || text.length >= 6;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function maskPixelRegions(pixels, width, height, regions) {
    if (!pixels || pixels.length < width * height * 4) return pixels;
    for (const region of Array.isArray(regions) ? regions : []) {
      const startX = Math.max(1, Math.min(width - 2, Math.floor(region.x)));
      const endX = Math.max(startX + 1, Math.min(width - 1, Math.ceil(region.x + region.width)));
      const startY = Math.max(0, Math.min(height, Math.floor(region.y)));
      const endY = Math.max(startY, Math.min(height, Math.ceil(region.y + region.height)));
      for (let y = startY; y < endY; y += 1) {
        const leftOffset = (y * width + startX - 1) * 4;
        const rightOffset = (y * width + endX) * 4;
        for (let x = startX; x < endX; x += 1) {
          const ratio = (x - startX + 1) / (endX - startX + 1);
          const offset = (y * width + x) * 4;
          for (let channel = 0; channel < 3; channel += 1) {
            pixels[offset + channel] = Math.round(
              pixels[leftOffset + channel] * (1 - ratio) + pixels[rightOffset + channel] * ratio
            );
          }
          pixels[offset + 3] = 255;
        }
      }
    }
    return pixels;
  }

  function analyzeBottomTextBand(pixels, width, height) {
    if (!pixels || width < 24 || height < 16 || pixels.length < width * height * 4) {
      return { score: 0, hash: "", bandCenter: 0, edgeDensity: 0 };
    }

    const size = width * height;
    const luma = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      const offset = index * 4;
      luma[index] = Math.round(pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114);
    }

    const edges = new Uint8Array(size);
    const rowDensity = new Float32Array(height);
    let totalEdges = 0;
    for (let y = 1; y < height - 1; y += 1) {
      let rowEdges = 0;
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const leftOffset = (index - 1) * 4;
        const upOffset = (index - width) * 4;
        const lumaGradient = Math.max(
          Math.abs(luma[index] - luma[index - 1]),
          Math.abs(luma[index] - luma[index - width])
        );
        const colorGradient = Math.max(
          Math.abs(pixels[offset] - pixels[leftOffset]),
          Math.abs(pixels[offset + 1] - pixels[leftOffset + 1]),
          Math.abs(pixels[offset + 2] - pixels[leftOffset + 2]),
          Math.abs(pixels[offset] - pixels[upOffset]),
          Math.abs(pixels[offset + 1] - pixels[upOffset + 1]),
          Math.abs(pixels[offset + 2] - pixels[upOffset + 2])
        );
        if (lumaGradient >= 34 || colorGradient >= 52) {
          edges[index] = 1;
          rowEdges += 1;
        }
      }
      rowDensity[y] = rowEdges / Math.max(1, width - 2);
      totalEdges += rowEdges;
    }

    const globalDensity = totalEdges / Math.max(1, (width - 2) * (height - 2));
    const bandRatios = [0.07, 0.11, 0.16, 0.22];
    let best = { merit: 0, average: 0, occupancy: 0, y: 0, height: 1 };

    for (const ratio of bandRatios) {
      const bandHeight = Math.max(4, Math.round(height * ratio));
      for (let y = 1; y <= height - bandHeight - 1; y += 1) {
        let rowSum = 0;
        for (let row = y; row < y + bandHeight; row += 1) rowSum += rowDensity[row];
        const average = rowSum / bandHeight;

        const columns = 14;
        let occupied = 0;
        for (let column = 0; column < columns; column += 1) {
          const startX = Math.max(1, Math.floor((column / columns) * width));
          const endX = Math.min(width - 1, Math.ceil(((column + 1) / columns) * width));
          let columnEdges = 0;
          for (let row = y; row < y + bandHeight; row += 1) {
            for (let x = startX; x < endX; x += 1) columnEdges += edges[row * width + x];
          }
          const area = Math.max(1, (endX - startX) * bandHeight);
          if (columnEdges / area >= 0.022) occupied += 1;
        }
        const occupancy = occupied / columns;
        const excess = Math.max(0, average - globalDensity * 0.72);
        const merit = average * 0.48 + excess * 0.42 + occupancy * 0.018;
        if (merit > best.merit) best = { merit, average, occupancy, y, height: bandHeight };
      }
    }

    const excess = Math.max(0, best.average - globalDensity * 0.72);
    const densityScore = clamp01((best.average - 0.028) / 0.115);
    const concentrationScore = clamp01((excess - 0.012) / 0.085);
    const occupancyScore = clamp01((best.occupancy - 0.12) / 0.58);
    const baseScore = densityScore * 0.3 + concentrationScore * 0.52 + occupancyScore * 0.18;
    const texturePenalty = clamp01((globalDensity - 0.16) / 0.25) * 0.75;
    const score = clamp01(baseScore * (1 - texturePenalty));

    const gridX = 24;
    const gridY = 8;
    let hash = "";
    const threshold = Math.max(0.025, best.average * 0.72);
    for (let gy = 0; gy < gridY; gy += 1) {
      const startY = Math.floor(best.y + (gy / gridY) * best.height);
      const endY = Math.max(startY + 1, Math.floor(best.y + ((gy + 1) / gridY) * best.height));
      for (let gx = 0; gx < gridX; gx += 1) {
        const startX = Math.floor((gx / gridX) * width);
        const endX = Math.max(startX + 1, Math.floor(((gx + 1) / gridX) * width));
        let count = 0;
        for (let y = startY; y < Math.min(height, endY); y += 1) {
          for (let x = startX; x < Math.min(width, endX); x += 1) count += edges[y * width + x];
        }
        const area = Math.max(1, (endY - startY) * (endX - startX));
        hash += count / area >= threshold ? "1" : "0";
      }
    }

    return {
      score,
      hash,
      bandCenter: (best.y + best.height / 2) / height,
      edgeDensity: best.average,
      globalDensity
    };
  }

  function evaluateEmbeddedSamples(samples) {
    const usable = (Array.isArray(samples) ? samples : []).filter((sample) => Number.isFinite(sample?.score));
    if (usable.length < 3) {
      return { decision: "pending", confidence: 0, positiveCount: 0, sampleCount: usable.length };
    }
    const positives = usable.filter((sample) => sample.score >= 0.5);
    const uniqueHashes = new Set(positives.map((sample) => sample.hash).filter(Boolean));
    const average = positives.length
      ? positives.reduce((total, sample) => total + sample.score, 0) / positives.length
      : 0;
    const centers = positives.map((sample) => sample.bandCenter).filter(Number.isFinite);
    const centerSpread = centers.length ? Math.max(...centers) - Math.min(...centers) : 1;
    const detected = positives.length >= 3 && uniqueHashes.size >= 2 && average >= 0.57 && centerSpread <= 0.24;
    return {
      decision: detected ? "detected" : usable.length >= 6 ? "not-detected" : "pending",
      confidence: Math.round(average * 100),
      positiveCount: positives.length,
      sampleCount: usable.length,
      centerSpread
    };
  }

  global.YTLangCore = Object.freeze({
    RULES,
    CHANNEL_RULE_MODES,
    HONG_KONG_COLLOQUIAL_RULES,
    DEFAULT_SETTINGS,
    normalizeLanguageCode,
    isAutomatic,
    familyOf,
    mergeSettings,
    migrateStoredSettings,
    normalizeReplacementRules,
    normalizeChannelRules,
    applyLiteralReplacements,
    applyHongKongColloquial,
    isLocalTextConversionEnabled,
    shouldApplyCustomReplacements,
    shouldMonitorCaptions,
    findTraditionalTarget,
    chooseCaptionPlan,
    channelRuleFor,
    embeddedDetectionSkipReason,
    normalizeCueText,
    isUsefulCue,
    maskPixelRegions,
    analyzeBottomTextBand,
    evaluateEmbeddedSamples
  });
})(globalThis);
