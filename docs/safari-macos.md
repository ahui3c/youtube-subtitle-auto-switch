# Safari Mac 開發與驗證

此專案只規劃 macOS Safari Web Extension；目前不建立 iPhone 或 iPad target。

## 共用核心邊界

- Chrome 正式版仍使用根目錄 `manifest.json`，預設輸出維持 `dist/`。
- Safari Mac 使用 `manifest.safari.json`，輸出到 `dist-safari/`。
- `src/core.js`、`src/page-bridge.js`、`src/content.js`、`src/background.js`、彈出面板與 OpenCC 資源由兩個平台共用。
- `src/platform.js` 只負責平台辨識與能力旗標，不改寫 Chrome API 行為。
- Safari 專屬 manifest 或相容處理不得回寫成 Chrome 的降級路徑。

## Windows 可完成的工作

```powershell
pnpm run test
pnpm run check
pnpm run build:all
```

Chrome 正式測試使用 `dist/`；Safari 原始 Web Extension 使用 `dist-safari/`。

## 必須在 Mac 完成的工作

1. 使用 Safari 16 或更新版本，在 Safari 的 Developer 設定中選擇 **Add Temporary Extension…**，先載入 `dist-safari/` 做快速測試。
2. 正式封裝時安裝 Xcode，執行：

   ```bash
   xcrun safari-web-extension-packager /path/to/dist-safari \
     --app-name "Youtube 字幕全自動開關" \
     --bundle-identifier "com.ahui3c.youtube-subtitle-auto-switch" \
     --swift
   ```

3. 在 Xcode 專案中只保留 macOS target，不加入 iOS 或 iPadOS target。
4. 設定 Apple Developer Team、Signing 與 App Store Connect 資料。

## Safari Mac 必測項目

- 使用者允許 `youtube.com` 網站權限前後，內容腳本與面板顯示是否正確。
- YouTube 一般影片、Shorts、SPA 換片、手動字幕、自動字幕及登入／未登入狀態。
- 繁體、簡體、未定義中文及粵語字幕選擇和 OpenCC 本機轉換。
- 工具列圖示、設定儲存、背景 service worker 被 Safari 卸載後重新喚醒。
- VIP Google 帳號連接流程。Safari 的身分驗證 API 與回傳網址必須以實際封裝後的 extension ID 驗證，未通過前不能宣稱支援。
- 內嵌字幕偵測為實驗性：逐次授權、分頁非作用中、不同影片比例及 Safari 拒絕擷取時都必須安全降級，不得影響 CC 選擇與字幕轉換。

## 發布閘門

Safari 的錯誤或功能降級不能更動 Chrome manifest、Chrome 建置輸出或 Chrome 預設功能。任何共用核心修改都必須先通過完整自動測試及 Chrome 實機回歸，再進入 Safari 封裝測試。
