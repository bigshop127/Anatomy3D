# 開源資源調查（2026-10-24）

目標：做一個像 Complete Anatomy／3D Anatomy 那樣，能點選、分層、精細的人體 3D 互動 App。
這份是動工前查到的開源程式與資料，以及為什麼選現在這個底。

## 結論

- **程式底子用 [ashemag/human-atlas](https://github.com/ashemag/human-atlas)**（MIT），從它的 `1c38bf3`（2026-09-06）分出來，保留完整 git 歷史，`upstream` 指向原 repo，之後可以 `git fetch upstream` 拿它的更新。
- **3D 資料用 BodyParts3D 4.0**（CC BY 4.0，human-atlas 已經轉好、可直接用）。
- 之後要補細節或女性模型，再從 Z-Anatomy、HRA 參考器官、Open Anatomy 拿（授權各不同，見下）。

## 可以直接拿來改的 App（程式）

| 專案 | 技術 | 授權 | 規模 | 評估 |
|---|---|---|---|---|
| [ashemag/human-atlas](https://github.com/ashemag/human-atlas) | React 19＋Three.js＋Vite＋Tailwind v4 | 程式 MIT／資料 CC BY 4.0 | 2,234 個可點選網格、15 個系統、3,432 個名稱概念、約 229 萬三角面、壓縮後約 33 MB；4.3k 星 | **採用**。效能做得好（合批繪製、GPU 貼圖控制顯示／選取），手機版面有測過，程式量小好改 |
| [authorOd/3d-anatomy-atlas](https://github.com/authorOd/3d-anatomy-atlas)（Svitylo） | Web component＋Three.js | CPAL-1.0（必須顯示 Svitylo 標誌、不能關） | 4,454 個結構、約 300 萬三角面 | 不採用（授權要掛別人的商標，且作者自己說資料授權稽核未完成）。**互動設計值得抄**：周邊層級、周邊透明度滑桿、網址分享狀態 |
| [ivershuo/somakine](https://github.com/ivershuo/somakine) | TypeScript 框架＋Three.js | MIT | BodyParts3D 4.0 肌肉骨骼 | 很新（4 星）。定位是教育／健身／**復健**，資料模型（標準 ID、部位多對多）可參考 |
| [LluisV/Z-Anatomy](https://github.com/LluisV/Z-Anatomy) | Unity（C#） | CC BY-SA 4.0 | 約 800 MB | 不採用（Unity 專案，跟網頁 PWA 路線不合） |
| [biocat-ugent/Open-Anatomy-Explorer](https://github.com/biocat-ugent/Open-Anatomy-Explorer) | Angular＋後端 | Apache-2.0 | — | 不採用（偏老師出題用，要架後端） |

## 3D 資料

| 資料 | 內容 | 授權 | 用途 |
|---|---|---|---|
| [BodyParts3D 4.0](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html)（日本 DBCLS） | 成年男性（TARO MRI＋插畫修正），每個結構一個 OBJ，帶 FMA 編號與 IS-A／PART-OF 樹 | **CC BY 4.0**（[官方授權頁](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html) 2025-02-27 更新；OBJ 檔頭寫的舊 CC BY-SA 2.1 JP 已被取代） | **目前使用** |
| [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy)（Blender 範本） | 以 BodyParts3D 為基礎，由醫學插畫家重新整理，附名稱標籤與 Wikipedia 定義 | CC BY-SA 4.0；**其中內耳（CC BY-NC-SA）和腎臟（CC BY-NC）不可商用** | 第二階段補細節的候選。要裝 Blender 匯出；用了之後衍生的資料要跟著 CC BY-SA |
| HRA 3D 參考器官（HuBMAP） | GLB，女性 v1.5 有 888 個網格（全身外表＋部分器官，骨骼肌肉不完整） | CC BY 4.0（[資料頁](https://lod.humanatlas.io/ref-organ/united-female/v1.5)） | 女性模型候選（human-atlas 舊版用過） |
| [Open Anatomy Project](https://openanatomy.org/)（哈佛 SPL） | 頭頸、腹部、膝、腦等局部圖譜，CT／MRI 分割 | 3D Slicer License 第 B 節（要再細看） | 局部高精細候選（例如膝） |
| NIH 3D、Sketchfab | 單一模型 | 每個模型授權不同 | 個案挑選 |
| Zygote、BioDigital、Visible Body、Complete Anatomy | — | 商用、不開放 | 不能用 |

## 中文名稱

BodyParts3D 只有英文（FMA 名稱）。查了兩個來源，都不夠直接套：

- **Wikidata**（FMA 編號 P1402）：3,432 個概念中 658 個有中文標籤；但真正對應到 3D 網格的 1,659 個概念只有 136 個有（BodyParts3D 把左右側分成不同概念，Wikidata 沒有）。
- **國家教育研究院〈人體解剖學學術名詞〉**（[data.gov.tw/dataset/14549](https://data.gov.tw/dataset/14549)，政府資料開放授權第 1 版，6,223 條）：多半是拉丁名，直接比對只中 60／1,674；有些條目斷字怪（例如「韁松果」），要人工把關。

→ 建議做法：由 Claude 依 FMA 英文名翻成台灣常用譯名（「左／右」「上／下」用規則組合），拿上面兩份交叉核對，App 裡標「未校對」；重點部位（肌肉骨骼）請使用者校對。

## 精細度的現實

- 商用 App 是付費建模團隊做的上萬個結構、高解析貼圖和肌肉動畫。開放資料目前追不上的：周邊神經細支、手足小韌帶、皮膚細節、肌肉起止點標示、關節動作動畫（BodyParts3D 是靜態網格，沒有骨架綁定）。
- 做得到的：結構點選、分層剝離、透明／X 光、剖面切割、標籤、中文、搜尋、測驗、物理治療用的肌肉卡。
