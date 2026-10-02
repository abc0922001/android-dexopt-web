# Android Dexopt Studio Web (WebADB ART 效能最佳化工具)

[![Deploy to GitHub Pages](https://github.com/abc0922001/android-dexopt-web/actions/workflows/deploy.yml/badge.svg)](https://github.com/abc0922001/android-dexopt-web/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

純前端 WebADB Android ART Dexopt 效能最佳化管理工具。透過瀏覽器 WebUSB API 與 Android 裝置進行 ADB 通訊，提供視覺化的 ART 編譯狀態檢視、常用度排序、單一 App 手動編譯（`speed` / `speed-profile`），以及全局觸發系統級 `bg-dexopt-job`。

---

## 🌟 核心功能特色

* **純靜態單頁應用 (SPA)**：無需在電腦安裝 Python、Node.js 伺服器或 Android SDK 命令列工具，直接使用支援 WebUSB 的現代瀏覽器（Chrome、Edge、Brave、Opera）即可操作。
* **高階分層掃描 (Layered App Categorization)**：
  * **常用應用 (Frequently Used)**：整合 `dumpsys usagestats` 前景活躍度統計與第三方 Launcher App 篩選，優先列出最需要 AOT 加速的應用。
  * **一般應用 (General)**：完整列出可進行 AOT 編譯的系統預載 App、背景服務與工具。
  * **不支援 AOT (Cannot AOT)**：自動識別純資產包、無程式碼模組（`hasCode=false`）、主題覆蓋包（Overlay）與無 Dex 檔案之套件。
* **防凍結串流批次擷取 (No N+1 Queries)**：單次管線流式擷取 `dumpsys package` 與 `pm list packages -f`，即使裝置安裝 300+ 應用程式也能在數秒內解析完成。
* **雙重編譯模式選擇器 (Dexopt Mode Selector)**：
  * **`speed`**：完整 AOT 編譯所有位元碼，啟動速度最快，但消耗較多儲存空間。
  * **`speed-profile`**：依據 JIT 熱點設定檔進行重點編譯，平衡空間與效能（同系統預設）。
* **全域系統排程控制**：支援一鍵觸發 Android 系統級 `bg-dexopt-job`，並提供隨時中斷任務（`cancel-bg-dexopt-job`）機制。
* **即時終端輸出抽屜 (Live Terminal Drawer)**：即時串流顯示所有 ADB 指令輸出、執行時間與狀態，支援一鍵複製與清空。
* **明暗雙色主題 (Dark / Light Mode)**：依據設計規範精準重現深色與淺色精緻介面，自動偵測系統喜好並持久化設定。
* **內建模擬示範模式 (Interactive Demo Mode)**：即便手邊暫無實體 Android 裝置，也能立即一鍵進入模擬 Pixel 8 環境，體驗所有操作流程。

---

## 📸 視覺介面預覽

| 深色模式 (Dark Theme) | 淺色模式 (Light Theme) |
| :---: | :---: |
| ![Dark Theme](./img/Dark.jfif) | ![Light Theme](./img/Light.jfif) |

---

## 🛠️ 本地開發與建置

### 前置需求
* Node.js 18+ 或更高版本
* npm 9+

### 常用指令

```bash
# 1. 安裝相依套件
npm install

# 2. 啟動本地開發伺服器 (支援熱重載)
npm run dev

# 3. 執行單元測試
npm test

# 4. 建置靜態發布包至 dist/
npm run build

# 5. 本地預覽生產建置成果
npm run preview
```

---

## 🚀 部署至 GitHub Pages

本專案已配置好標準 GitHub Actions 自動部署腳本（[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)）。

1. 將本儲存庫推送至 GitHub 的 `main` 分支。
2. 進入 GitHub Repository **Settings** > **Pages**。
3. 在 **Build and deployment** > **Source** 下拉選單中選擇 **GitHub Actions**。
4. 部署工作流完成後，即可在 `https://<YOUR-USERNAME>.github.io/<REPO-NAME>/` 上直接使用！

---

## 📱 Android 手機連線指引

1. **開啟開發人員選項**：
   * 前往手機【設定】>【關於手機】> 連續快速點擊「版本號碼」7 次，直到出現「您已成為開發人員」。
2. **啟用 USB 偵錯**：
   * 前往【系統】>【開發人員選項】> 開啟「USB 偵錯」。
3. **USB 連接與授權**：
   * 將傳輸線連接至電腦。
   * 在網頁右上角點選「連接裝置 (Connect)」。
   * 手機螢幕會跳出提示視窗，請務必勾選「永遠允許這台電腦進行偵錯」並按下「確定」。

### 常見問題排查

* **出現 `claimInterface` 或連線介面被鎖定**：
  * 若電腦本機已安裝 Android Studio 或背景正在運行 `adb` 伺服器，可能導致 WebUSB 接口被佔用。
  * 請在電腦終端機輸入：`adb kill-server` 後重試連線。
* **瀏覽器不支援**：
  * WebUSB API 僅支援 Chromium 核心瀏覽器（Google Chrome、Microsoft Edge、Brave、Opera 等）。
  * 瀏覽器安全性規範要求必須於 HTTPS 或 `localhost` 環境下才能存取 WebUSB。

---

## 📄 開源授權

本專案基於 [MIT License](LICENSE) 條款開源。
