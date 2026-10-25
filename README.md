# Anatomy3D

人體 3D 互動解剖 App（自用、手機平板優先）。目標是做到像 Complete Anatomy 那樣能點選、分層、透明、剖面的精細度，偏重物理治療用的肌肉骨骼內容。

- 網址：<https://bigshop127.github.io/Anatomy3D/>（手機用瀏覽器打開後可「加到主畫面」，模型下載過一次之後離線也能開）
- 規格與路線圖：[ROADMAP.md](ROADMAP.md)
- 開源資源調查與選型理由：[docs/RESEARCH.md](docs/RESEARCH.md)

## 來源

程式從 [ashemag/human-atlas](https://github.com/ashemag/human-atlas)（MIT）的 `1c38bf3`（2026-09-06）分出來，保留完整歷史。要拿原作者後續的更新：

```sh
git fetch upstream
git merge upstream/main
```

## 本機執行

需要 Node.js 22.13 以上，不需要任何金鑰。

```sh
npm ci
npm run dev        # http://localhost:3016
```

檢查與建置（GitHub Actions 部署前也跑同一套，沒過就不會上線）：

```sh
npm run check      # 型別
npm run validate   # 模型、互動、中文名稱
npm run build      # 輸出在 dist/
npm exec vite preview   # 用正式站的路徑看 build 結果：http://localhost:4173/Anatomy3D/
```

## 部署

push 到 `main` 就會由 `.github/workflows/deploy.yml` 自動檢查、建置、發布到 GitHub Pages。網站放在 `/Anatomy3D/` 底下，程式裡的檔案路徑一律用 `asset()`（`app/model-download.ts`）加上這個前綴。

離線快取在 `public/sw.js`：頁面和目錄檔每次先連網、斷網才用快取；模型檔先用快取。模型檔名是內容指紋，`MODELS` 快取名稱由 `npm run atlas` 依模型內容自動換，裝過的手機下次打開就會換成新模型。

## 模型

`public/models/atlas.json` 是構造目錄（名稱、系統、圖譜概念、外框），幾何在 `m-<內容指紋>.bin`（另有 .gz）。格式 `meshopt-1`：每個部件的位置以 0.05 mm 為一格存成 16 位元整數（加上部件自己的原點）、法線 8 位元八面體編碼、三角形重排後編碼，再用 meshoptimizer 壓縮；App 用 `app/model-decode.ts` 解開。

改模型一律跑 `npm run atlas`（`scripts/build-atlas.mjs`）：讀現在的模型、套用 `scripts/source-fixes.json` 的上游資料修正（左右標反、改名、拿掉重複），寫出新的模型檔和目錄、刪掉沒用到的舊檔、更新 `sw.js` 的快取名稱。已經編碼過的部件會原封不動複製，所以重跑結果不變、也不會越壓越糊。改完要重跑 `npm run layers`、`npm run members`，再跑 `npm run validate`。

給 Blender 腳本用的原始幾何：`node scripts/dump-atlas-geometry.mjs` 輸出到 `work/atlas-raw/`（不進版控）。BodyParts3D 原始 OBJ 的轉檔程式是 `scripts/convert-anatomy.py`（v0.7.0 以前的格式，留作來源紀錄）。

## 中文名稱

`app/names.zh-TW.json` 是中文譯名表：

- `terms`：英文名（小寫、去掉 left／right）→ 台灣用語。左右側由程式自動加「左／右」，例如 `Left femur` → 左股骨。
- `overrides`：整個名稱直接對照，給自動規則翻不好的少數名稱用。
- `reviewed`：校對過的 `terms` 鍵。不在這裡的名稱，App 會標「未校對」。

改完跑 `node scripts/validate-names.mjs`，它會檢查每個構造都有中文、沒有殘留英文、沒有沒用到的詞條。

人工校對用 `scripts/review-sheets.mjs`：`npm run review -- export <資料夾>` 依部位產生校對頁（Markdown 表格「英文名｜目前中文｜你的修改｜備註」，已填的修改重產時會保留），`npm run review -- apply <資料夾>` 把修改寫回譯名表，狀態改成「已校對」的頁面整頁加進 `reviewed`；「你的修改」以 `?` 開頭的是問題，不會套用。校對頁放在使用者自己的筆記裡，不進 repo。

## 肌肉分層

「剝層」工具用的層次在 `app/muscle-layers.json`，由 `npm run layers`（`scripts/compute-muscle-layers.mjs`）產生：在每塊肌肉表面取樣往外射線，沒被其他肌肉、骨頭、內臟擋住的算最淺層，剝掉再算下一層。物理治療常用肌群照教科書分層，寫在 `scripts/muscle-layer-overrides.json`（名稱用英文小寫、不含 left/right），改完重跑 `npm run layers`。上游把幾塊肌肉歸錯系統，修正表在 `app/system-fixes.ts`。

## 部位

部位快捷的裁切框在 `app/regions.ts`，由各部位的骨頭範圍自動算出，`scripts/validate-regions.mjs` 檢查大小與左右側。

每個構造屬於哪些部位記在 `app/region-members.json`，由 `npm run members`（`scripts/compute-region-members.mjs`）產生：骨頭屬於它定義的部位；肌肉、韌帶、椎間盤、軟骨屬於它實際碰到（4 mm 內）的那些部位骨頭所在的部位，所以跨兩個關節的肌肉兩邊都算；其他構造看包圍盒有沒有一半以上在部位框裡。算不到的教科書歸屬補在 `scripts/region-member-overrides.json`。校對頁和之後的測驗範圍都用這份。改了模型或部位定義要重跑。

## 3D 資料

使用 **BodyParts3D 4.0**（成年男性參考模型），2,234 個可個別點選的網格、3,432 個名稱概念、約 229 萬個三角面，壓縮後約 33 MB。轉檔流程見 `scripts/`，完整出處與改動說明見 [public/ATTRIBUTION.md](public/ATTRIBUTION.md)。

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

本 App 為學習用途，不是診斷或手術工具。

## 授權

- 程式：MIT（見 [LICENSE](LICENSE)，保留原作者聲明）
- 3D 資料：CC BY 4.0（BodyParts3D），轉發時要保留出處
- 第三方套件依各自授權
