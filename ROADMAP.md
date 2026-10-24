# Anatomy3D 規格草案與路線圖

> 狀態：**草案，待使用者確認**（2026-10-24）。確認後照「開發分工」流程：Claude 實作＋測試＋自我 review → push → 使用者驗收。
> 資源調查與選型理由見 [docs/RESEARCH.md](docs/RESEARCH.md)。

## 目標

給自己用的人體 3D 解剖 App，手機、平板、電腦都能用，操作像 Complete Anatomy：點結構看名稱與說明、分層剝開、透明、剖面、搜尋。偏重物理治療需要的肌肉骨骼內容。

## 第 0 階段：建專案（已完成，2026-10-24）

- [x] 從 human-atlas `1c38bf3` 分出來，保留歷史；`origin` = `bigshop127/Anatomy3D`（私人），`upstream` = `ashemag/human-atlas`
- [x] 本機跑起來：型別檢查、build、`validate-atlas`、`validate-interactions` 全過
- [x] 資源調查寫進 `docs/RESEARCH.md`

## 第 1 階段：中文化＋整理（建議先做）

- [ ] 介面全部繁體中文
- [ ] 每個結構有中文名＋英文名（＋FMA 編號），中英文都能搜尋；中文名先由 Claude 翻譯，用國教院名詞與 Wikidata 交叉核對，標「未校對」
- [ ] 清掉沒用到的東西：`vinext`、`@openai/sites-vite-plugin`、`@cloudflare/*`、`wrangler`、`recharts`、`react-server-dom-webpack`、`date-fns` 等套件，以及 65 個 shadcn 元件裡沒用到的 59 個
- [ ] 改名 Anatomy3D；做成 PWA（可加到主畫面，模型下載一次後離線也能開）
- [ ] 部署上線（見下方「待確認」第 3 點）

## 第 2 階段：互動（像 Complete Anatomy）

- [ ] X 光模式：沒選到的結構變半透明，可用滑桿調
- [ ] 剖面：矢狀／冠狀／水平切面，拖曳移動
- [ ] 分層剝離：皮膚 → 淺層肌 → 深層肌 → 骨骼（BodyParts3D 沒有深淺資訊，要先用規則加人工標註）
- [ ] 釘選標籤（引線＋名稱）、多選、隱藏／復原、存視角書籤、網址分享目前畫面
- [ ] 部位快捷鍵：頸、胸椎肋骨、腰骨盆、肩、肘腕手、髖、膝、踝足、顳顎（對齊 PT-CDSS 的分類）

## 第 3 階段：物理治療內容

- [ ] 肌肉卡：起點、止點、作用、神經支配、血液供應（來源：Wikipedia／Wikidata＋使用者讀書筆記整理；原文書內容只放自己的摘要，不整段抄）
- [ ] 測驗模式：給名稱點結構、點結構答名稱
- [ ] （之後）從 PT-CDSS 評估頁直接跳到對應 3D 部位

## 第 4 階段：資料擴充

- [ ] Z-Anatomy 匯出流程（要裝 Blender），補 BodyParts3D 不足的部分；注意授權會變 CC BY-SA，內耳／腎臟不可商用
- [ ] 女性模型（HRA 參考器官 v1.5，CC BY 4.0）
- [ ] 局部高精細（例如 Open Anatomy 膝關節，授權先確認）
- [ ] 升級 three.js（目前 0.159，2023 年版）

## 做不到或很難的（先講清楚）

- 關節動作／肌肉收縮動畫：BodyParts3D 是靜態網格、沒有骨架綁定，要自己綁，工程很大
- 商用 App 等級的細節（周邊神經細支、手足小韌帶、皮膚貼圖）：開放資料目前沒有

## 待確認

1. **repo 可見度**：目前是私人 repo。要不要改公開？（公開才能用免費的 GitHub Pages；私人也能部署，見第 3 點）
2. **第 1 階段範圍**：照上面做可以嗎？要先做哪個階段？
3. **部署方式**：建議 Cloudflare Pages（私人 repo 可用、免費、你已有 Cloudflare 帳號）；也可以用 Firebase Hosting 或改公開用 GitHub Pages
4. **肘腕手**：PT-CDSS 不做肘腕手，3D App 要不要也略過，還是照樣涵蓋全身？

## 授權義務（每次發布都要遵守）

- 程式：MIT，保留 `LICENSE` 裡原作者 ashemag 的版權聲明
- 3D 資料：CC BY 4.0，App 內要保留 BodyParts3D 出處（`public/ATTRIBUTION.md`）
- 之後加 Z-Anatomy 或 Wikipedia 內容：CC BY-SA，衍生資料要同授權並標出處
