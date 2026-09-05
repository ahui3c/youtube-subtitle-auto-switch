(function initYTLangInstanceCoordinator(global) {
  "use strict";

  const PRODUCT = "ahui3c.youtube-subtitle-auto-switch";
  const PROTOCOL_VERSION = 1;
  const MARKER_NAME = "ytlang-extension-instance";
  const DEVELOPMENT_DISTRIBUTION = "development";
  const CHROME_STORE_DISTRIBUTION = "chrome-web-store";
  const OFFICIAL_CHROME_EXTENSION_ID = "akcaiofhidblmchmmakfmhdjfhcglhig";

  function versionParts(value) {
    return String(value || "0")
      .split(/[.-]/)
      .slice(0, 4)
      .map((part) => Number.parseInt(part, 10) || 0);
  }

  function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference > 0 ? 1 : -1;
    }
    return 0;
  }

  function classifyDistribution(extensionId, buildDistribution) {
    if (String(extensionId || "") === OFFICIAL_CHROME_EXTENSION_ID) {
      return CHROME_STORE_DISTRIBUTION;
    }
    if (String(buildDistribution || "") === CHROME_STORE_DISTRIBUTION) {
      return DEVELOPMENT_DISTRIBUTION;
    }
    return String(buildDistribution || "unknown");
  }

  function preferredInstance(left, right) {
    const versionComparison = compareVersions(left?.version, right?.version);
    if (versionComparison > 0) return left;
    if (versionComparison < 0) return right;

    const leftDistribution = String(left?.distribution || "unknown");
    const rightDistribution = String(right?.distribution || "unknown");
    if (leftDistribution !== rightDistribution) {
      if (leftDistribution === DEVELOPMENT_DISTRIBUTION) return left;
      if (rightDistribution === DEVELOPMENT_DISTRIBUTION) return right;
      if (leftDistribution === CHROME_STORE_DISTRIBUTION) return right;
      if (rightDistribution === CHROME_STORE_DISTRIBUTION) return left;
    }

    return String(left?.extensionId || "").localeCompare(String(right?.extensionId || "")) <= 0
      ? left
      : right;
  }

  function validExtensionId(value) {
    return /^[a-p]{32}$/.test(String(value || ""));
  }

  global.YTLangInstanceCoordinator = Object.freeze({
    PRODUCT,
    PROTOCOL_VERSION,
    MARKER_NAME,
    DEVELOPMENT_DISTRIBUTION,
    CHROME_STORE_DISTRIBUTION,
    OFFICIAL_CHROME_EXTENSION_ID,
    compareVersions,
    classifyDistribution,
    preferredInstance,
    validExtensionId
  });
})(globalThis);
