(function initYTLangPlatform(global) {
  "use strict";

  const api = global.chrome || global.browser || null;
  let runtimeUrl = "";
  try {
    runtimeUrl = String(api?.runtime?.getURL?.("") || "");
  } catch {}

  const safariScheme = runtimeUrl.startsWith("safari-web-extension://");
  const safariUserAgent = /\bSafari\//.test(String(global.navigator?.userAgent || ""))
    && !/\b(?:Chrome|Chromium|Edg)\//.test(String(global.navigator?.userAgent || ""));
  const browser = safariScheme || safariUserAgent ? "safari" : "chrome";

  const platform = Object.freeze({
    api,
    browser,
    isChrome: browser === "chrome",
    isSafari: browser === "safari",
    target: browser === "safari" ? "safari-macos" : "chrome",
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
