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

離線快取在 `public/sw.js`：頁面和目錄檔每次先連網、斷網才用快取；模型檔先用快取。**改了 `public/models/*.bin` 就要把 `sw.js` 裡的 `MODELS` 版本加一**，否則裝過的手機會繼續用舊模型。

## 中文名稱

`app/names.zh-TW.json` 是中文譯名表：

- `terms`：英文名（小寫、去掉 left／right）→ 台灣用語。左右側由程式自動加「左／右」，例如 `Left femur` → 左股骨。
- `overrides`：整個名稱直接對照，給自動規則翻不好的少數名稱用。
- `reviewed`：校對過的 `terms` 鍵。不在這裡的名稱，App 會標「未校對」。

改完跑 `node scripts/validate-names.mjs`，它會檢查每個構造都有中文、沒有殘留英文、沒有沒用到的詞條。

## 3D 資料

使用 **BodyParts3D 4.0**（成年男性參考模型），2,234 個可個別點選的網格、3,432 個名稱概念、約 229 萬個三角面，壓縮後約 33 MB。轉檔流程見 `scripts/`，完整出處與改動說明見 [public/ATTRIBUTION.md](public/ATTRIBUTION.md)。

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

本 App 為學習用途，不是診斷或手術工具。

## 授權

- 程式：MIT（見 [LICENSE](LICENSE)，保留原作者聲明）
- 3D 資料：CC BY 4.0（BodyParts3D），轉發時要保留出處
- 第三方套件依各自授權
