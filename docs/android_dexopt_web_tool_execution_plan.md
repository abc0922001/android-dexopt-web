# 專案執行計畫：WebADB Android ART Dexopt 效能最佳化管理工具

本文件作為 AI Agent 或軟體工程師開發「純前端 WebADB Android Dexopt 最佳化工具」的完整規格需求（PRD）、技術實作指導以及 GitHub Pages 部署規範。

---

## 1. 專案目標與技術架構

* **目標**：打造一個純靜態單頁應用（SPA），透過瀏覽器 WebUSB API 與 Android 裝置進行 ADB 通訊，提供視覺化的 ART 編譯狀態檢視、常用度排序、單一 App 手動編譯（`speed` / `speed-profile`），以及全局觸發系統級 `bg-dexopt-job`。
* **技術棧**：
  * **前端架構**：原生單一 HTML5（或 Vite + Vanilla / React SPA）+ TailwindCSS + 原生 JavaScript (ES Modules)。
  * **核心通訊庫**：`@yume-chan/adb` 與 `@yume-chan/adb-backend-webusb`（可透過 ESM CDN 如 `esm.sh` 載入或前端套件管理打包）。
  * **金鑰管理**：Web Cryptography API 生成 RSA-2048 金鑰對，並持久化至 IndexedDB 以免每次重複跳出授權視窗。
* **發布平台**：GitHub Pages（純靜態託管，預設強制 HTTPS 滿足 WebUSB 安全規範）。

---

## 2. 核心功能規格需求

### 功能 1：裝置連接與分層掃描 (Device Connection & App Retrieval)
1. **連線觸發**：
   * 點擊「連接裝置」按鈕，呼叫 `navigator.usb.requestDevice()`，過濾條件：`classCode: 255, subclassCode: 66, protocolCode: 1`。
   * 完成 ADB 握手，並等待使用者於手機端確認「允許 USB 偵錯」。
2. **App 盤點與排序分群邏輯**（依照規格分為三大優先級）：
   * **優先群 (Top - 常用 App)**：
     * 判定標準：
       1. 透過 `dumpsys usagestats` 查詢近期前景使用時間（`TOTAL_TIME_IN_FOREGROUND`）大於 0 的套件；或
       2. 具備可見啟動圖示的第三方 App（`cmd package query-intent-activities -a android.intent.action.MAIN -c android.intent.category.LAUNCHER` 且非系統內建）。
   * **次要群 (Middle - 一般 App)**：
     * 其餘能進行 AOT 編譯的系統預載 App、背景服務類 App、非頻繁使用的第三方工具。
   * **末尾群 (Bottom - 無法 AOT 的 App)**：
     * 判定標準：
       * 屬於純資產包、無程式碼（`hasCode=false`）、純 Overlay 主題包、或 Dexopt 狀態顯示為 `verify-none` / `error` / 缺少 Dex 檔案之 App。
       * 透過 `dumpsys package <pkg>` 解析確認無 Dex 檔案或無法被編譯。

### 功能 2：全域工作排程器 (Top Global Actions)
* 頁面最頂端常駐「執行 `bg-dexopt-job`」操作區：
  * **觸發按鈕**：「觸發系統背景最佳化 (`bg-dexopt-job`)」。
  * **ADB 指令**：`cmd package bg-dexopt-job`（舊版備援：`pm bg-dexopt-job`）。
  * **狀態回饋**：
    * 該指令為非同步或長時間執行工作，需顯示「執行中...」旋轉動畫與即時輸出終端日誌。
    * 提供「中斷任務」按鈕（指令：`cmd package cancel-bg-dexopt-job`）。
  * **執行後行為**：完成後自動重新掃描當前清單之編譯狀態並局部更新。

### 功能 3：編譯模式選擇器 (Dexopt Mode Selector)
* 全域提供模式切換開關（Dropdown 或 Segmented Control）：
  * **選項 A：`speed`**（完整 AOT 編譯所有位元碼，啟動速度最快，但消耗最多儲存空間）。
  * **選項 B：`speed-profile`**（依據 JIT 熱點設定檔進行重點編譯，平衡空間與效能，同系統背景預設模式）。
* 支援全域設定預設值，個別 App 旁的最佳化按鈕將依據當前選定的模式進行編譯。

### 功能 4：App 列表與狀態展示 (Dexopt State Display)
* 每個 App 項目顯示卡需包含：
  1. **應用資訊**：App 圖示（如有）、顯示名稱、套件名稱（Package Name）。
  2. **編譯狀態標籤**（精準還原 Android 格式）：
     * 範例：`[status=speed-profile] [reason=bg-dexopt]` 或 `[status=speed] [reason=cmdline]`。
     * 色彩區分：
       * 綠色：`speed` / `speed-profile`
       * 黃色：`verify` / `quicken`
       * 灰色：`unknown` / `none` (無法 AOT)
  3. **操作按鈕**：
     * 右側「最佳化」按鈕（點擊後執行所選模式之編譯）。

### 功能 5：單一 App 最佳化執行 (Per-App Optimization)
* 點擊 App 旁的「最佳化」按鈕：
  * **ADB 指令**：
    * 若選定 `speed`：`cmd package compile -m speed -f <package_name>`
    * 若選定 `speed-profile`：`cmd package compile -m speed-profile -f <package_name>`
  * **即時回饋**：按鈕轉為 Loading 狀態，執行完畢後立即下達局部 `dumpsys package <package_name>`，重新解析並即時將標籤更新為最新狀態。

---

## 3. 系統底層 ADB 指令與解析管線 (Technical Pipeline)

### 3.1 批次掃描最佳化（防止 N+1 查詢瓶頸）
> ⚠️ **效能關鍵**：若手機內有 300 個 App，逐一執行 300 次 `dumpsys package <pkg>` 會耗時數分鐘以上導致網頁凍結。AI Agent **必須**採用管線批次獲取方式：

```bash
# 步驟 1：列出所有安裝套件（包含路徑資訊）
pm list packages -f

# 步驟 2：獲取使用量統計以標記「常用 App」
dumpsys usagestats | grep "TOTAL_TIME_IN_FOREGROUND"

# 步驟 3：批次拉取 Dexopt 狀態（單一指令串流解析）
dumpsys package | grep -E "(Package \[|status=|reason=|Primary-Dex)"
```

### 3.2 正規表示式解析規則 (Regex Engine)
* **套件名稱解析**：
  * 模式：`/package:.*\/base\.apk=(?<pkg>[a-zA-Z0-9_\.]+)/`
* **Dexopt 狀態解析**：
  * 在 `dumpsys package <pkg>` 區塊內抓取：
  * 模式：`/\[status=(?<status>[a-zA-Z0-9_-]+)\]\s+\[reason=(?<reason>[a-zA-Z0-9_-]+)\]/`
* **無法 AOT 判定**：
  * 若輸出包含 `apk does not have code`、找不到 Dex 紀錄、或在 `dumpsys package` 內標註 `hasCode=false`，將其歸類至 `CANNOT_AOT` 分組。

---

## 4. 介面佈局與狀態管理 (UI / UX Specification)

```
+-----------------------------------------------------------------------------------+
|  [Logo] Android Dexopt Studio Web                       [ 狀態: 已連線 Pixel 8 ]  |
+-----------------------------------------------------------------------------------+
|  [ 全局操作區 ]                                                                   |
|  [⚡ 執行系統 bg-dexopt-job ]   [模式選擇: (•) speed  ( ) speed-profile ]         |
|  * 提示: speed 編譯時間較長且最佔空間；speed-profile 僅針對常用熱點編譯。        |
+-----------------------------------------------------------------------------------+
|  [ 搜尋套件... ] [ 篩選: 全部 (342) | 常用 (18) | 一般 (300) | 不支援 (24) ]       |
+-----------------------------------------------------------------------------------+
|  ▼ 常用應用程式 (Frequently Used Apps)                                           |
|  +-----------------------------------------------------------------------------+ |
|  | [圖示] Google Chrome (com.android.chrome)                                    | |
|  | 狀態: [status=speed-profile] [reason=bg-dexopt]            [ ⚡ 最佳化 (speed) ] | |
|  +-----------------------------------------------------------------------------+ |
|  | [圖示] LINE (jp.naver.line.android)                                         | |
|  | 狀態: [status=speed] [reason=cmdline]                      [ ⚡ 最佳化 (speed) ] | |
|  +-----------------------------------------------------------------------------+ |
|                                                                                   |
|  ▼ 其他已安裝應用程式 (Other Apps)                                                |
|  +-----------------------------------------------------------------------------+ |
|  | [圖示] 系統計算機 (com.google.android.calculator)                            | |
|  | 狀態: [status=verify] [reason=vdex]                        [ ⚡ 最佳化 (speed) ] | |
|  +-----------------------------------------------------------------------------+ |
|                                                                                   |
|  ▼ 不支援 AOT / 無代碼模組 (Cannot AOT)                                          |
|  +-----------------------------------------------------------------------------+ |
|  | [圖示] Pixel Live Wallpaper Stub (com.google...overlay)                     | |
|  | 狀態: [status=N/A] [reason=no-code]                         [ 不支援最佳化  ]  | |
|  +-----------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------------+
```

---

## 5. 例外處理與邊界情況 (Edge Cases & Resilience)

1. **本機 ADB 衝突（USB 佔用）**：
   * 當 `requestDevice` 成功但傳輸管道被鎖定時，提示用戶：「電腦本機可能正在運行 ADB Server，請在電腦終端機輸入 `adb kill-server` 後再試」。
2. **手機未授權**：
   * 若回應 `AUTH_FAILED`，畫面顯示顯眼的指引動畫：「請解鎖手機並勾選【永遠允許這台電腦進行偵錯】」。
3. **編譯逾時處理**：
   * 單一 App 執行 `compile -m speed` 若程式碼極為龐大，可能需花費 10~30 秒。按鈕必須有 Disable 防連點機制並顯示進度指示。
4. **離線與拔除重連**：
   * 監聽 `navigator.usb.addEventListener('disconnect')`，裝置斷開時自動重設 UI 狀態至「未連線」，並清空暫存數據。

---

## 6. GitHub Pages 部署規範與推送指引 (GitHub & Deployment Guide)

### 6.1 專案目錄結構規範
若採純靜態單檔或 Vite 靜態構建，推薦目錄配置如下：

```text
android-dexopt-web/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 自動部署工作流
├── .gitignore
├── README.md
├── index.html                  # 核心頁面（含 ESM 引用或打包入口）
├── package.json                # （若使用 Vite / npm 套件模式）
└── src/                        # （可選，若使用模組化拆分）
    ├── main.js
    ├── adb-controller.js
    └── parser.js
```

### 6.2 GitHub Actions 自動部署腳本 (`.github/workflows/deploy.yml`)
提供現成標準工作流，推送至 `main` 分支時自動發布至 GitHub Pages：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # 若為純 HTML/JS 靜態專案，無須建置步驟，直接上傳根目錄
      - name: Setup Pages
        uses: actions/configure-pages@v5

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: '.' # 若有經過 npm run build，可改為 './dist'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### 6.3 終端機 Git 初始化與初次推送步驟 (Terminal Commands)
當專案程式碼產出後，依序執行下列指令將專案推上 GitHub：

```bash
# 1. 初始化本地 Git 儲存庫
git init

# 2. 建立忽略清單
cat << 'EOF' > .gitignore
node_modules/
dist/
.DS_Store
*.log
EOF

# 3. 提交初始版本
git add .
git commit -m "feat: initial commit for Android Dexopt Web tool"

# 4. 指定主分支名稱為 main
git branch -M main

# 5. 綁定 GitHub 遠端儲存庫（請將 <YOUR-USERNAME> 與 <REPO-NAME> 換成實際路徑）
git remote add origin https://github.com/<YOUR-USERNAME>/<REPO-NAME>.git

# 6. 推送至遠端儲存庫
git push -u origin main
```

### 6.4 GitHub Pages 服務啟用步驟
1. 開啟 GitHub 專案頁面，點選右上角 **Settings**。
2. 於左側選單點選 **Pages**。
3. 在 **Build and deployment** > **Source** 下拉選單中：
   * 若使用上述 Action：選擇 **GitHub Actions**。
   * 若直接指定分支發布：選擇 **Deploy from a branch**，並指定 `main` 分支的 `/ (root)` 目錄。
4. 儲存後等待 1~2 分鐘，即可在提供之 GitHub Pages 網址（例如 `https://<YOUR-USERNAME>.github.io/<REPO-NAME>/`）存取應用。

### 6.5 GitHub Pages 環境與 WebUSB 注意事項
1. **強制 HTTPS**：WebUSB API 規定必須在安全上下文（Secure Context）下運行。GitHub Pages 預設提供 SSL/TLS 憑證（`https://`），完全符合此硬性規定。
2. **基底路徑（Base Path）處理**：
   * 若專案非自訂網域名稱，網址將為 `/<REPO-NAME>/`。
   * 若使用前端打包工具（如 Vite），`vite.config.js` 必須設定 `base: './'` 或 `base: '/<REPO-NAME>/'`，以防找不到靜態資產。
3. **Permissions-Policy**：GitHub Pages 預設不會封鎖 `usb` 權限，無須額外設定 HTTP 標頭即可呼叫 `navigator.usb`。

---

## 7. Agent 實作階段里程碑 (Milestones)

* **Phase 1（連線與驗證）**：整合 `@yume-chan/adb`，完成 WebUSB 連接、RSA 認證保存、裝置型號讀取。
* **Phase 2（資料獲取管線）**：實作單一指令流取得全套件與 Dexopt 狀態剖析器，並依「常用 > 一般 > 不支援 AOT」完成排序演算法。
* **Phase 3（編譯指令下達）**：實作全域 `bg-dexopt-job` 與個別 App 之 `cmd package compile`，包含執行中鎖定與刷新機制。
* **Phase 4（UI 精緻化）**：套用 Tailwind 質感面板，加入狀態徽章顏色映射、關鍵字搜尋過濾與即時日誌抽屜。
* **Phase 5（CI/CD 與發布）**：配置 `.github/workflows/deploy.yml`，驗證 GitHub Pages 上的 WebUSB 喚起行為與靜態路徑相容性。