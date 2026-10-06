# Android Dexopt Studio Web — AI Agent 指南

本文件旨在讓接手的 AI Agent 能在最短時間內精確掌握專案架構、底層原理、核心模組職責與開發規範，省去無謂的探索時間。

---

## 1. 專案概述與架構定位（Overview & Architecture）

`Android Dexopt Studio Web` 是一套**純前端、零後端（Pure Client-side, Zero Backend）**的 Android ART (Android Runtime) Dexopt AOT 編譯效能管理工具。

### 核心運作機制：
1. **WebUSB 直連：** 透過瀏覽器的 WebUSB API 與 `@yume-chan/adb` (Tango ADB) 實作 ADB 協定，在不需要電腦安裝 ADB 指令列工具的情況下，直接透過瀏覽器與手機溝通。
2. **純靜態部署：** 專案構建後為純靜態 HTML/JS/CSS，部署於 GitHub Pages。
3. **100% 離線運作支援（PWA + Service Worker）：** 
   - 透過 `public/sw.js` 實作 Cache-First / Stale-While-Revalidate 與導航離線快取。
   - 使用者在平板／電腦無 Wi-Fi、無行動網路的環境下，仍可直接開啟網頁，透過 USB 線對手機執行所有 AOT 指令（WebUSB 操作完全在本機 USB 控制器運作，不依賴網路）。
4. **示範模式（Demo Mode）：** 內建模擬裝置資料與指令回傳，無需硬體設備即可在任何瀏覽器完整測試所有 UI 與編譯邏輯。

---

## 2. Android ART 與 Dexopt 領域知識（Domain Knowledge）

### 什麼是 Dexopt / ART AOT？
Android 應用程式打包為 APK 時內含 Dalvik Bytecode (`.dex`)。Android Runtime (ART) 在執行時可透過 AOT (Ahead-of-Time) 編譯將 Dex 字節碼預先編譯為本機機器碼（ELF / OAT），大幅減少 JIT 運行時開銷與掉幀，提升啟動速度與流暢度。

### 編譯過濾器（Compilation Filter / Mode）：
- `speed`：**最高等級編譯**。將 App 的所有程式碼全數編譯為機器碼。執行最快，但耗時最長、佔用儲存空間最大。
- `speed-profile`：**設定檔引導編譯（Profile-guided）**。僅編譯系統在背景收集到的熱點代碼（Hot Code）。若 App 剛安裝尚無 profile，系統常會自動退回 `verify`。
- `verify`：**僅校驗位元組碼**。不進行機器碼 AOT 編譯，運行時仰賴 JIT 解釋執行。
- `quicken` / `vdex`：輕度最佳化，僅進行部分 DEX 操作碼優化。

### 核心 ADB 指令對應：
- 單一 App 編譯：`cmd package compile -m <mode> [-f] <package>`
  - `-f` (force)：強制重新編譯（即使系統認為已是該狀態）。
  - 無 `-f`（快速 AOT 模式）：若 App 已滿足條件則跳過，專門針對 `verify` 快速拉升至 `speed` 或 `speed-profile`。
- 系統全局背景最佳化：`cmd package bg-dexopt-job`（舊版系統 fallback 為 `pm bg-dexopt-job`）。
- 中斷全局背景最佳化：`cmd package cancel-bg-dexopt-job`。
- 強制停止應用：`am force-stop <package>`（強制終止 App 背景進程，確保下次啟動立即載入最新 AOT 機器碼）。
- 查詢狀態：
  - 批次查詢：`dumpsys package dexopt`。
  - 單一查詢：`dumpsys package <package>`。

### Android 14+ ART Service 差異：
Android 14 引進模組化 ART Service，`dumpsys` 輸出格式發生重大變化：
- 舊版 Android：`[status=speed-profile] [reason=bg-dexopt]`
- Android 14+：`compilation_filter=speed-profile, compilation_reason=cmdline`
`src/parser.js` 內的 `parseDumpsysPackageStream` 已同時相容這兩種格式。修改 Parser 時務必保留正則雙軌解析相容性。

---

## 3. 檔案地圖與模組職責（File Map & Responsibilities）

```
android-dexopt-web/
├── index.html              # 應用主結構、Tailwind 樣式標籤、卡片網格、互動對話框 (Modal)
├── public/                 # 靜態資源 (Vite build 會原樣複製到 dist/)
│   ├── sw.js               # Service Worker：快取 App Shell、支援 100% 離線運作 (Issue #1)
│   ├── manifest.webmanifest# PWA Web App Manifest 配置
│   ├── icon.svg            # 向量 App 圖標
│   ├── icon-192.png        # 192x192 PWA 圖標
│   └── icon-512.png        # 512x512 PWA 圖標
├── src/
│   ├── main.js             # 主控制層：UI 事件綁定、狀態機、Modal 控制、卡片渲染
│   ├── adb-controller.js   # ADB 控制層：WebUSB 連線認證、Subprocess 指令執行、示範模式 Mock
│   ├── parser.js           # 純資料解析層：Dumpsys 串流解析、套件分類 (Frequently Used 等)、排序
│   ├── queue-manager.js    # AOT 佇列管理員：單一 App 連續點擊循序調度、去重、即時狀態流
│   ├── style.css           # Tailwind CSS v4 入口、CSS Container Queries (.app-card)、自訂滾動條
│   └── icons.js            # SVG 圖示字典與套件專屬圖示對應
├── test/                   # 單元測試 (Node.js Native Test Runner)
│   ├── parser.test.js      # Parser、分類演算法、排序演算法測試
│   ├── layout.test.js      # 平板/桌面斷點排版與 Headless Chrome 容器查詢計算測試
│   ├── fastaot.test.js     # 快速 AOT 模式 (無 -f、僅 verify、支援 speed 與 speed-profile) 測試
│   ├── queue.test.js       # AOT 任務佇列循序執行、取消等待、去重測試
│   └── offline.test.js     # PWA、Service Worker 快取策略與離線註冊測試
├── package.json            # 依賴定義與 npm scripts (test, build, preview)
└── vite.config.js          # Vite 設定：base: './' (適應 GitHub Pages 子路徑)
```

---

## 4. 關鍵技術規則與踩坑防範（Critical Rules & Gotchas）

### 規則 1：WebUSB 單一通道限制（Serial Command Pipeline）
WebUSB 上的 ADB 通道為單一傳輸連線。**絕對不可在同一個 WebUSB 連線上同時並行發送多個子進程編譯指令**，否則會造成封包穿插或斷線。
- 連續點擊單一 App 卡片時，必須透過 `queueManager.enqueue()` 循序處理。
- 當佇列尚有任務進行中時，批次編譯與 Fast AOT 會被鎖定或需防護阻擋。

### 規則 2：CSS 容器查詢自我樣式陷阱（Container Query Scoping）
根據 CSS Container Queries Module Level 3 規範：
- 宣告了 `container-type: inline-size` 的容器元素（例如 `.app-card`）**不能**在 `@container` 內為自身設定排版樣式。
- 只有其**子代元素**（例如 `.app-card-header`、`.app-card-info`）才會受到容器查詢的尺寸驅動。
- 請勿將 `@container` 的選取器直接指向容器本身。

### 規則 3：相對路徑與 GitHub Pages 部署相容性
- `vite.config.js` 設定為 `base: './'`。
- HTML、Service Worker 與 JS 中引用資源時，請使用相對路徑（`./` 或相對 URL），切勿寫死絕對根目錄 `/`，以確保專案部署於 `https://<user>.github.io/<repo>/` 子目錄時資源不會 404。

---

## 5. 測試與構建驗證流程（Quality Gate）

專案採用 Node.js 內建測試運行器 (`node:test` + `node:assert/strict`)，不額外依賴重型測試套件。

在進行任何 Git Commit 之前，必須執行：
```bash
# 1. 執行全套單元測試 (含 Parser、Layout、Queue、FastAOT、Offline)
npm test

# 2. 執行 Vite 生產打包，確認產物無錯誤
npm run build
```

---

## 6. Git Commit 時機與執行協議（Git Commit Protocol）

你在執行程式碼撰寫與修改時，必須嚴格遵守以下 Git Commit 時機與原則：

### 1. 觸發 Commit 的時機（When to Commit）
你必須在滿足以下任一「原子條件」且驗證通過時，立即執行 Commit：
* **綠燈時刻（Task Completed & Verified）：** 完成單一函式、模組或功能改動，且已執行相關測試（Unit Tests / Build / Type Check）確認通過。
* **重構與格式化隔離（Style/Refactor Shift）：** 剛完成純程式碼重構、排版整理、重新命名或 Lint 修正時，必須立即獨立 Commit，絕不與業務邏輯修改混雜。
* **冒險前錨點（Pre-Exploration Checkpoint）：** 在準備進行高風險架構重構、大規模套件更換或嘗試不確定解法前，先將目前穩定的狀態 Commit 作為還原基準點。
* **缺陷根因修復（Bug Isolated & Fixed）：** 成功定位並修復單一 Bug、驗證有效後立即 Commit，不可夾帶任何「順手修改」的無關程式碼。
* **子任務切分點（Sub-task Boundary）：** 當使用者指派複合型任務時，每完成計畫中的一個子步驟並確認無誤，即刻 Commit 一次。

### 2. 嚴禁 Commit 的情境（When NOT to Commit）
* **編譯失敗或測試未過：** 程式碼處於 Broken 狀態時絕不 Commit。
* **混雜多重意圖：** 單次改動涵蓋兩個以上不相關的檔案修改或意圖時，不可合併 Commit，必須拆分暫存（Staging）。
* **邏輯半成品：** 功能僅完成一半、尚未形成閉環邏輯時不可 Commit（除非使用者明確要求建立 WIP Checkpoint）。

### 3. 提交前檢查清單（Pre-Commit Checklist）
在執行 `git commit` 前，你必須於背景執行以下自我檢驗：
1. 執行 `git status` 與 `git diff`，確認 Staged 變更僅包含該任務的最小相關檔案。
2. 確認此 Commit 具備**可獨立編譯性**與**可安全回滾性（Revertible）**。
3. 確認 Commit Message **嚴格使用正體中文（繁體中文）**撰寫。

### 4. 訊息語言與格式規範（Commit Message Language & Format）
* **強制使用正體中文：** 所有 Git Commit Message（包含標題與內文說明）**一律強制使用正體中文（繁體中文）**撰寫，嚴禁使用簡體中文或純英文 Commit（Conventional Commits 類型標籤如 `feat:`、`fix:` 可保留英文前綴）。
* **格式範例：**
  - `feat: 支援快速 AOT 模式 (僅處理 verify 應用且不加 -f)`
  - `fix: 修復平板模式卡片標題擠壓與排版過窄問題`
  - `docs: 完善 AGENTS.md 架構說明、領域知識與開發規範`
  - `refactor: 抽離 AOT 佇列管理至獨立模組`