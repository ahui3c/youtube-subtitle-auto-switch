(function installPreviewShim() {
  "use strict";
  if (globalThis.chrome?.storage?.sync) return;

  const memory = {
    sync: {},
    local: {
      status: {
        videoId: "preview-video",
        title: "設定面板預覽",
        planType: "opencc",
        sourceName: "中文（簡體）",
        sourceLanguageCode: "zh-Hans",
        captureArmed: true,
        detectionSamples: 2,
        lastDetectionScore: 64,
        lastDetectionBand: 76,
        detectionComplete: false,
        embeddedDetected: false
      }
    },
    session: {}
  };

  function area(name) {
    return {
      get(key, callback) {
        const result = typeof key === "string" ? { [key]: memory[name][key] } : { ...memory[name] };
        queueMicrotask(() => callback?.(result));
        return Promise.resolve(result);
      },
      set(value, callback) {
        Object.assign(memory[name], value);
        queueMicrotask(() => callback?.());
        return Promise.resolve();
      },
      remove(key) {
        delete memory[name][key];
        return Promise.resolve();
      }
    };
  }

  const previewChrome = globalThis.chrome || {};
  previewChrome.storage = { sync: area("sync"), local: area("local"), session: area("session") };
  previewChrome.tabs = {
      query(query, callback) {
        queueMicrotask(() => callback([{ id: 1, url: "https://www.youtube.com/watch?v=preview" }]));
      },
      sendMessage(tabId, message, callback) {
        queueMicrotask(() => callback?.({ ok: true }));
      }
    };
  previewChrome.runtime = {
      lastError: null,
      getManifest() { return { version: "preview" }; },
      getURL(path) { return new URL(`../${path}`, location.href).href; },
      sendMessage() { return Promise.resolve({ ok: true }); }
    };
  globalThis.chrome = previewChrome;
})();
