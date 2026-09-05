# Firefox 桌面版開發與驗證

Firefox 版本與 Chrome 版本共用 `src/` 核心，但使用獨立的 `manifest.firefox.json`、`dist-firefox/` 與發布套件。預設 `pnpm run build` 仍只建置 Chrome，不會覆寫 Chrome 的 `dist/`。

## 建置

```powershell
pnpm run test
pnpm run build:chrome
pnpm run build:firefox
```

Firefox 的解壓縮建置位於 `dist-firefox/`。開發測試時，在 Firefox 開啟 `about:debugging#/runtime/this-firefox`，選擇「載入暫用附加元件」，再選取 `dist-firefox/manifest.json`。

## 平台差異

- Firefox Manifest V3 使用 `background.scripts` 事件背景頁；Chrome 繼續使用原本的 `background.service_worker`。
- Firefox 128 起才支援 manifest 中的 `world: "MAIN"`。本專案為同時符合桌面版與 Android 的新附加元件資料傳輸揭露機制，最低版本設定為 Firefox 142。
- Firefox 固定附加元件 ID 是 `youtube-subtitle-auto-switch@ahui3c.com`。VIP 授權回傳網址會由此 ID 的 SHA-1 產生，網站只允許本產品的精確 Firefox 網址，不接受其他 Firefox 外掛。
- 字幕文字、影片影格與 OCR 結果仍只在瀏覽器本機處理。只有使用者主動登入／同步時，帳號驗證資料與選用的頻道規則會傳送到 `myapp.ahui3c.com`。

## 發布前人工測試

1. 一般、劇院與全螢幕模式各測一次字幕選擇及 OCR。
2. 測試 Google 登入、24 小時試用、已購買 VIP 與登出。
3. 測試自訂詞彙及指定頻道規則的本機保存、雲端同步與離線回復。
4. 使用 `web-ext lint` 檢查 `dist-firefox/`，再送交 addons.mozilla.org 簽署。

Firefox 商店上架與正式簽署是獨立發布動作，不會更新或覆蓋 Chrome 商店版本。
