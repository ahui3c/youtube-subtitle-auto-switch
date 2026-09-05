(function initYTLangPlatform(global) {
  "use strict";

  const candidateApi = global.chrome || global.browser || null;
  let runtimeUrl = "";
  try {
    runtimeUrl = String(candidateApi?.runtime?.getURL?.("") || "");
  } catch {}

  const safariScheme = runtimeUrl.startsWith("safari-web-extension://");
  const firefoxScheme = runtimeUrl.startsWith("moz-extension://");
  const userAgent = String(global.navigator?.userAgent || "");
  const firefoxUserAgent = /\bFirefox\//.test(userAgent);
  const edgeUserAgent = /\bEdg(?:A|iOS)?\//.test(userAgent);
  const safariUserAgent = /\bSafari\//.test(userAgent)
    && !/\b(?:Chrome|Chromium|Edg)\//.test(userAgent);
  const browser = firefoxScheme || firefoxUserAgent
    ? "firefox"
    : safariScheme || safariUserAgent
      ? "safari"
      : edgeUserAgent
        ? "edge"
        : "chrome";
  const api = browser === "firefox"
    ? (global.browser || candidateApi)
    : candidateApi;

  const platform = Object.freeze({
    api,
    browser,
    isChrome: browser === "chrome",
    isEdge: browser === "edge",
    isFirefox: browser === "firefox",
    isSafari: browser === "safari",
    target: browser === "safari" ? "safari-macos" : browser,
    capabilities: Object.freeze({
      embeddedSubtitleDetection: Object.freeze({
        available: typeof api?.tabs?.captureVisibleTab === "function",
        experimental: browser === "safari"
      }),
      extensionIdentity: Object.freeze({
        available: typeof api?.identity?.getRedirectURL === "function"
          && typeof api?.identity?.launchWebAuthFlow === "function",
        requiresSafariValidation: browser === "safari"
      })
    })
  });

  global.YTLangPlatform = platform;
})(globalThis);
