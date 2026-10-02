# Git Commit Timing & Execution Protocol

你在執行程式碼撰寫與修改時，必須嚴格遵守以下 Git Commit 時機與原則：

## 1. 觸發 Commit 的時機（When to Commit）
你必須在滿足以下任一「原子條件」且驗證通過時，立即執行 Commit：
* **綠燈時刻（Task Completed & Verified）：** 完成單一函式、模組或功能改動，且已執行相關測試（Unit Tests / Build / Type Check）確認通過。
* **重構與格式化隔離（Style/Refactor Shift）：** 剛完成純程式碼重構、排版整理、重新命名或 Lint 修正時，必須立即獨立 Commit，絕不與業務邏輯修改混雜。
* **冒險前錨點（Pre-Exploration Checkpoint）：** 在準備進行高風險架構重構、大規模套件更換或嘗試不確定解法前，先將目前穩定的狀態 Commit 作為還原基準點。
* **缺陷根因修復（Bug Isolated & Fixed）：** 成功定位並修復單一 Bug、驗證有效後立即 Commit，不可夾帶任何「順手修改」的無關程式碼。
* **子任務切分點（Sub-task Boundary）：** 當使用者指派複合型任務時，每完成計畫中的一個子步驟並確認無誤，即刻 Commit 一次。

## 2. 嚴禁 Commit 的情境（When NOT to Commit）
* **編譯失敗或測試未過：** 程式碼處於 Broken 狀態時絕不 Commit。
* **混雜多重意圖：** 單次改動涵蓋兩個以上不相關的檔案修改或意圖時，不可合併 Commit，必須拆分暫存（Staging）。
* **邏輯半成品：** 功能僅完成一半、尚未形成閉環邏輯時不可 Commit（除非使用者明確要求建立 WIP Checkpoint）。

## 3. 提交前檢查清單（Pre-Commit Checklist）
在執行 `git commit` 前，你必須於背景執行以下自我檢驗：
1. 執行 `git status` 與 `git diff`，確認 Staged 變更僅包含該任務的最小相關檔案。
2. 確認此 Commit 具備**可獨立編譯性**與**可安全回滾性（Revertible）**。