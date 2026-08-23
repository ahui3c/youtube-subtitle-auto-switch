import test from "node:test";
import assert from "node:assert/strict";

const listeners = new Map();
let appliedDescriptor;
let captionsEnabled = false;

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

const player = {
  loadModule() {},
  setOption(module, option, descriptor) {
    assert.equal(module, "captions");
    assert.equal(option, "track");
    appliedDescriptor = descriptor;
  }
};

const captionsButton = {
  disabled: false,
  getAttribute(name) {
    return name === "aria-pressed" ? String(captionsEnabled) : null;
  },
  click() {
    captionsEnabled = !captionsEnabled;
  }
};

globalThis.CustomEvent = FakeCustomEvent;
globalThis.location = { href: "https://www.youtube.com/watch?v=test" };
globalThis.window = globalThis;
window.setInterval = () => 1;
window.clearInterval = () => {};
window.setTimeout = (callback) => {
  callback();
  return 1;
};
globalThis.document = {
  title: "測試影片 - YouTube",
  visibilityState: "visible",
  getElementById(id) {
    return id === "movie_player" ? player : null;
  },
  querySelector(selector) {
    return selector === ".ytp-subtitles-button" ? captionsButton : null;
  },
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(listener);
  },
  dispatchEvent(event) {
    for (const listener of listeners.get(event.type) || []) listener(event);
    return true;
  }
};

await import("../src/page-bridge.js");

test("YouTube 翻譯描述包含語言代碼及顯示名稱", () => {
  document.dispatchEvent(new CustomEvent("ytlang:apply-plan", {
    detail: {
      type: "translate",
      videoId: "test",
      track: { languageCode: "zh-CN", vssId: ".zh-CN" },
      target: { languageCode: "zh-Hant", name: "中文（繁體）" }
    }
  }));

  assert.deepEqual(appliedDescriptor.translationLanguage, {
    languageCode: "zh-Hant",
    languageName: "中文（繁體）"
  });
  assert.equal(captionsEnabled, true);
});
