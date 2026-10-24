# Anatomy3D

人體 3D 互動解剖 App（自用、手機平板優先）。目標是做到像 Complete Anatomy 那樣能點選、分層、透明、剖面的精細度，偏重物理治療用的肌肉骨骼內容。

- 規格與路線圖：[ROADMAP.md](ROADMAP.md)（目前是草案、待確認）
- 開源資源調查與選型理由：[docs/RESEARCH.md](docs/RESEARCH.md)

## 來源

程式從 [ashemag/human-atlas](https://github.com/ashemag/human-atlas)（MIT）的 `1c38bf3`（2026-09-06）分出來，保留完整歷史。要拿原作者後續的更新：

```sh
git fetch upstream
git merge upstream/main
```

目前畫面與功能仍是原版（英文介面），改動從第 1 階段開始。

## 本機執行

需要 Node.js 22.13 以上，不需要任何金鑰。

```sh
npm ci
npm run dev        # http://localhost:3016
```

檢查與建置：

```sh
npm run check
node scripts/validate-atlas.mjs
node scripts/validate-interactions.mjs
npm run build      # 輸出在 dist/
```

## 3D 資料

使用 **BodyParts3D 4.0**（成年男性參考模型），2,234 個可個別點選的網格、3,432 個名稱概念、約 229 萬個三角面，壓縮後約 33 MB。轉檔流程見 `scripts/`，完整出處與改動說明見 [public/ATTRIBUTION.md](public/ATTRIBUTION.md)。

BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.

本 App 為學習用途，不是診斷或手術工具。

## 授權

- 程式：MIT（見 [LICENSE](LICENSE)，保留原作者聲明）
- 3D 資料：CC BY 4.0（BodyParts3D），轉發時要保留出處
- 第三方套件依各自授權
