# Android Dexopt Web 進階客製化與最佳化開發計畫 (PLAN.md)

本計畫旨在擴充 `android-dexopt-web` 的編譯控制能力。在不破壞現有免 Root（WebADB 標準 `shell` 權限）體驗的前提下，最大化榨出 Android 系統內建 `dex2oat` 與 ART Service（SDK $\ge 34$）/ PackageManagerService（SDK $< 34$）的潛在效能，並提供進階使用者更精細的資源調度與底層參數控制。

---

## 一、 現有架構盤點與切入點

目前專案的核心模組職責如下：
* `src/adb-controller.js`：負責封裝 WebADB 指令（區分 SDK $\ge 34$ 的 `cmd art` 與舊版 `cmd package`）、觸發編譯、重置與背景任務。
* `src/parser.js`：負責解析 `dumpsys package` 輸出，提取編譯過濾器狀態（`status`）、原因（`reason`）、Profile 狀態與 Secondary DEX 資訊。
* `src/queue-manager.js`：管理批次編譯佇列、併發與任務隔離。
* `src/main.js` & `index.html`：處理前端 UI 狀態綁定、篩選器與操作面板。

---

## 二、 階段一：免 Root 模式下的進階 `dex2oat` 參數擴充 (P0)

標準 `shell` 權限雖然無法直接透過 `setprop` 修改 `dalvik.vm.*` 屬性，但可以透過傳遞給 `cmd package compile`（或 `cmd art compile`）的原生旗標，加上讀取系統唯讀屬性，實現高度客製化的編譯行為。

### 1.1 編譯資源與溫控調度（透過 `-r <reason>` 控制 CPU 綁核與執行緒）
Android 各家晶片商（高通、聯發科）與 OEM 廠商會在系統中針對不同的編譯原因（Compiler Reason）預設不同的執行緒數量與 CPU 親和力（CPU-set）：
* **極速全核模式（Performance Mode）**：
  * 傳遞參數：`-r cmdline` 或 `-r first-boot`
  * 系統行為：動用大核與較多執行緒（對應 `dalvik.vm.dex2oat-threads`），適合插電並追求最短編譯時間。
* **溫和降溫模式（Cool / Background Mode）**：
  * 傳遞參數：`-r bg-dexopt` 或 `-r inactive`
  * 系統行為：系統自動讀取 `dalvik.vm.bg-dexopt.threads` 與 `dalvik.vm.bg-dexopt.cpu-set`，將 `dex2oat` 限制在背景小核執行，大幅降低手機發熱與前景卡頓，適合邊用手機邊在背景跑批次編譯。
* **實作細節**：
  * 在 `src/adb-controller.js` 的編譯函式新增 `reason` 選項參數。
  * 注意：當指定 `-r` 時，仍須明確帶上 `-m <filter>` 以確保使用者的目標編譯等級不被系統預設的 reason 對映表覆蓋。

### 1.2 新增 `everything` 極致全量編譯模式 (`-m everything`)
* **痛點**：`-m speed` 會編譯絕大多數方法，但仍會跳過部分類別靜態初始化（`<clinit>`）或極端龐大的方法；重度遊戲玩家或追求「零 JIT 介入」的使用者需要更徹底的選項。
* **實作細節**：
  * 在 UI 的編譯模式選單新增 `everything`（附帶空間佔用與耗時警告標籤）。
  * 在 `src/adb-controller.js` 支援 `-m everything -f`。

### 1.3 強制忽略 Profile 差異門檻 (`--check-prof false`)
* **痛點**：執行 `speed-profile` 時，若系統判斷目前的 Profile 與上次編譯時差異過小，即使加上 `-f`，有時仍會走捷徑或跳過重編譯。
* **實作細節**：
  * 在 UI 提供「強制重讀 Profile (`--check-prof false`)」勾選框（當選擇 `speed-profile` 時啟用）。
  * 指令組合：`cmd package compile -m speed-profile -f --check-prof false <package>`。

### 1.4 Profile 洗白與重建工作流（Clear & Re-profile）
* **痛點**：長期使用的 App 其 `.prof` 檔案可能累積大量過時的舊版路徑，導致 `speed-profile` 編譯了不再使用的程式碼，浪費空間卻沒加速當前操作。
* **實作細節**：
  * 新增「重置並清空 Profile」一鍵功能，在 `src/adb-controller.js` 支援 `-c`（Clear profile）搭配 `-m verify`：
    ```bash
    cmd package compile -c -m verify -f <package>
    ```
  * 在 UI 提示使用者：「執行後請正常操作該 App 數分鐘以收集純淨熱點，隨後再回來執行 `speed-profile` 編譯。」

### 1.5 Split APK（App Bundle）模組化精準編譯 (`--split`)
* **痛點**：現代大型 App 動輒包含十幾個 Split APK（多語系、資源包、動態功能模組），全量 `speed` 編譯耗時極長。
* **實作細節**：
  * 在 `src/parser.js` 解析套件底下的各個 Split APK 名稱與各自的編譯狀態。
  * 在單一 App 詳情彈窗中，允許使用者僅勾選 `base.apk` 或特定功能 Split 執行 `--split <split_name>` 獨立編譯。

---

## 三、 階段二：裝置環境探測與視覺化診斷升級 (P1)

雖然免 Root 無法「寫入」系統屬性，但 `shell` 權限完全可以透過 `getprop` **「讀取」** 當前手機的編譯器設定，讓使用者清楚知道自己的手機底層是如何配置 `dex2oat` 的。

### 2.1 裝置 `dex2oat` 硬體調度參數探測面板
連線成功後，由 `src/adb-controller.js` 執行一次 `getprop | grep -E "dalvik\.vm\.(.*dex2oat|.*dexopt)"`，並在 `src/parser.js` 解析以下關鍵指標顯示於「裝置資訊面板」：
* `dalvik.vm.dex2oat-threads` / `dalvik.vm.dex2oat-cpu-set`（一般編譯執行緒與核心）
* `dalvik.vm.bg-dexopt.threads` / `dalvik.vm.bg-dexopt.cpu-set`（背景省電編譯執行緒與核心）
* `dalvik.vm.boot-dex2oat-threads` / `dalvik.vm.image-dex2oat-threads`
* `dalvik.vm.dex2oat-flags` / `dalvik.vm.dex2oat-filter`
* `pm.dexopt.*`（各場景預設對應的 Compiler Filter）

> **價值**：當使用者在 UI 切換「極速模式 (`cmdline`)」與「省電降溫模式 (`bg-dexopt`)」時，介面可以直接顯示：**「您的裝置在省電模式下將使用 4 執行緒（核心 0-3），極速模式下將使用 8 執行緒（全核心）」**，大幅提升專業度與透明度。

### 2.2 編譯耗時與產物變化追蹤
* 在 `src/queue-manager.js` 記錄每個 App 編譯任務的精確耗時（毫秒 $\rightarrow$ 秒）。
* 編譯完成後自動觸發單一套件的 `dumpsys package <pkg>`，比對編譯前後的 `status`（例如 `verify` $\rightarrow$ `speed`）與 `reason` 變化，並在佇列結果中標示狀態躍遷徽章。

---

## 四、 階段三：選配 Root 專家級 `dex2oat` 引擎調校模式 (P2)

針對已具備 Root 權限（Magisk / KernelSU / APatch）的進階玩家，透過 `su -c` 動態注入 `setprop`，直接操控 `dex2oat` 編譯器內部的 SSA 最佳化管線參數。

### 3.1 Root 權限探測與安全還原機制（Safe Sandbox）
1. **探測**：提供「啟用 Root 專家模式」開關，點擊時執行 `su -c id` 驗證是否擁有 `uid=0`。
2. **備份與還原**：
   * 在批次佇列開始前，先讀取並備份原始的 `dalvik.vm.dex2oat-flags`、`dalvik.vm.dex2oat-threads` 與 `dalvik.vm.dex2oat-cpu-set` 於記憶體及 `localStorage`。
   * 當佇列執行完畢、使用者手動中止或發生斷線重連時，自動執行還原指令，確保不污染系統常態設定。

### 3.2 可調整的 `dex2oat` 內部旗標 (`dalvik.vm.dex2oat-flags`)
在「Root 專家面板」提供以下視覺化控制項：

| 控制項名稱 | 注入之 `dex2oat` 參數 | 執行效率 / 空間效益說明 |
| :--- | :--- | :--- |
| **積極內聯最佳化 (Aggressive Inlining)** | `--inline-max-code-units=128` `<br>` `--inline-depth-limit=6` | 放寬預設保守的函式內聯門檻，消除大量小型 `invoke-virtual` 呼叫開銷，提升滑動與運算幀率。 |
| **精簡產物體積 (Strip Mini-Debug-Info)** | `--no-generate-mini-debug-info` | 剔除 `.odex` 內的除錯回溯符號，可縮減約 $10\%$ 至 $20\%$ 的機器碼體積，降低載入時的 I/O 負擔。 |
| **自訂編譯執行緒數** | `setprop dalvik.vm.dex2oat-threads <N>` | 允許使用者透過滑桿（$1 \sim 16$）強制指定 `dex2oat` 平行編譯執行緒數。 |
| **自訂 CPU 核心親和力** | `setprop dalvik.vm.dex2oat-cpu-set <mask>` | 例如強制綁定超大核與大核（如 `4,5,6,7`）追求極致速度，或綁定小核（`0,1,2,3`）防止過熱降頻。 |
| **ARM 微架構指令集加速** | `--instruction-set-features=default,dotprod,fp16,i8mm` | 針對現代 ARMv8.2+ / ARMv9 處理器強制啟用點積與半精度浮點等硬體指令最佳化。 |

---

## 五、 程式碼修改清單與對應模組

### 1. `src/adb-controller.js`
* **修改 `compilePackage(pkg, options)`**：
  * 將原本僅接收 `(pkg, filter)` 的簽章擴充為接收設定物件：`{ filter, reason, checkProf, clearProfile, splitName, isSecondary }`。
  * 針對 SDK $\ge 34$ (`cmd art`) 與 SDK $< 34$ (`cmd package`) 建構對應的參數字串並進行參數合法性檢查（避免命令注入）。
* **新增 `getDexoptSystemProps()`**：
  * 執行 `getprop` 擷取 `dalvik.vm.*` 與 `pm.dexopt.*` 系統屬性。
* **新增 Root 輔助方法（選配）**：
  * `checkRootAccess()`、`applyCustomDex2oatProps(config)`、`restoreDex2oatProps(backup)`。

### 2. `src/parser.js`
* **新增 `parseSystemDexoptProps(rawOutput)`**：
  * 將 `getprop` 輸出結構化為 `{ defaultThreads, bgThreads, defaultCpuSet, bgCpuSet, extraFlags, pmFilters }`。
* **擴充 `parseDumpsysPackage(rawOutput)`**：
  * 除了主 APK 的 `status` 與 `reason` 外，解析 `splits:` 區段與各個 split 對應的編譯狀態。

### 3. `src/queue-manager.js`
* 為每個佇列項目記錄 `startTime` 與 `endTime`，計算單一套件編譯耗時。
* 若啟用了 Root 自訂屬性，在佇列 `onStart` 鉤子自動套用屬性，並在 `onComplete` / `onCancel` 鉤子確保觸發屬性還原。

### 4. `index.html` & `src/main.js`
* 在編譯工具列新增「**進階編譯設定（Advanced Options）**」折疊面板：
  * 資源調度模式切換：`預設` / `極速全核 (-r cmdline)` / `溫和省電 (-r bg-dexopt)`。
  * 核取方塊：`略過 Profile 差異檢查 (--check-prof false)`、`編譯前清空舊 Profile (-c)`。
  * 編譯模式下拉選單加入 `everything` 並加上 Tooltip 說明。
* 新增「**裝置 ART / dex2oat 環境資訊**」檢視彈窗，展示探測到的執行緒、CPU 核心配置與系統預設 Filter。

---

## 六、 測試驗證計畫 (`test/`)

為確保新功能不影響既有穩定度，需在 `test/` 目錄擴充以下單元測試：

1. **擴充 `test/parser.test.js`**：
   * 測試 `parseSystemDexoptProps()` 在不同品牌手機（Pixel、小米、三星）`getprop` 輸出格式下的解析正確性。
   * 測試包含多個 Split APK 的 `dumpsys package` 解析結果。
2. **新增 `test/advanced_compile_args.test.js`**：
   * 驗證 `adb-controller.js` 在組合 `-m`、`-r`、`--check-prof false`、`-c`、`--split` 以及 Secondary DEX (`--secondary-dex`) 時，針對 SDK 33 與 SDK 34+ 產生的 ADB 命令字串是否完全符合預期。
3. **擴充 `test/queue.test.js`**：
   * 驗證進階選項物件能正確透過 `queue-manager.js` 傳遞至底層控制器，並在取消佇列時正確執行清理回呼。