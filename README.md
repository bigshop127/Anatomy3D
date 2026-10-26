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
npm run validate   # 模型、互動、中文名稱、肌肉卡、起止點
npm run build      # 輸出在 dist/
npm exec vite preview   # 用正式站的路徑看 build 結果：http://localhost:4173/Anatomy3D/
```

## 部署

push 到 `main` 就會由 `.github/workflows/deploy.yml` 自動檢查、建置、發布到 GitHub Pages。網站放在 `/Anatomy3D/` 底下，程式裡的檔案路徑一律用 `asset()`（`app/model-download.ts`）加上這個前綴。

離線快取在 `public/sw.js`：頁面和目錄檔每次先連網、斷網才用快取；模型檔先用快取。模型檔名是內容指紋，`MODELS` 快取名稱由 `npm run atlas` 依模型內容自動換，裝過的手機下次打開就會換成新模型（起止點檔也是內容指紋，但不算在快取名稱裡，只改起止點不會讓手機重抓整個模型）。肌肉卡（`app/muscle-cards.json`）建置成獨立的小檔，模型載完才抓。

## 模型

`public/models/atlas.json` 是構造目錄（名稱、系統、圖譜概念、外框），幾何在 `m-<內容指紋>.bin`（另有 .gz）。格式 `meshopt-1`：每個部件的位置以 0.05 mm 為一格存成 16 位元整數（加上部件自己的原點）、法線 8 位元八面體編碼、三角形重排後編碼，再用 meshoptimizer 壓縮；App 用 `app/model-decode.ts` 解開。

改模型一律跑 `npm run atlas`（`scripts/build-atlas.mjs`）：讀現在的模型、套用 `scripts/source-fixes.json` 的上游資料修正（左右標反、改名、拿掉重複、拿掉被 Z-Anatomy 取代的三種迴旋肌），併入 `scripts/zanatomy-parts.json` 列的 Z-Anatomy 構造，寫出新的模型檔和目錄、刪掉沒用到的舊檔、更新 `sw.js` 的快取名稱。已經編碼過的部件會原封不動複製，所以重跑結果不變、也不會越壓越糊。改完要重跑 `npm run layers`、`npm run members`，再跑 `npm run validate`。

### 從 Z-Anatomy 補構造

BodyParts3D 缺的肌肉、韌帶、關節囊、滑囊、筋膜、周邊神經（898 個）來自 Z-Anatomy 的 Blender 範本 `Startup.blend`（放在 `work/zanatomy/source/`，不進版控；Blender 4.5 一律用 `-b -Y` 開，不跑檔案內嵌的腳本）。Z-Anatomy 的骨架擺位跟 BodyParts3D 差 2–3 cm，所以先把它的每塊骨頭對到我們的骨頭，做成位移場，再讓軟組織跟著骨頭變形：

```bash
node scripts/dump-atlas-geometry.mjs                     # 我們的模型 → work/atlas-raw/
B="C:/Tools/Blender/blender.exe -b -Y work/zanatomy/source/Startup.blend --python-exit-code 1 --python"
$B scripts/blender/align.py -- work/atlas-raw work/zanatomy     # 骨頭對齊 → warp.npy
$B scripts/blender/classify.py -- work/atlas-raw work/zanatomy  # 每個物件的種類、位置 → candidates.json
node scripts/zanatomy-select.mjs                         # 挑要補的、命名、搜尋群組 → scripts/zanatomy-parts.json
$B scripts/blender/export.py -- work/atlas-raw work/zanatomy scripts/zanatomy-parts.json  # 變形對齊＋推出骨面 → work/zanatomy/export/
node scripts/build-atlas.mjs --zanatomy work/zanatomy/export
npm run layers && npm run members && npm run validate
```

`scripts/zanatomy-parts.json` 是補進來的清單（Z-Anatomy 物件名、我們的編號 `Z`＋雜湊、名稱、系統）、搜尋群組（例如「膝關節（韌帶、半月板與關節囊）」「正中神經（含分支）」）、起止點貼片，以及沒拿的構造和原因。去重複先比名稱（同義詞表在 `zanatomy-select.mjs`），因為 Z-Anatomy 的肌肉形狀被插畫家改過，只比形狀會誤判。韌帶、關節囊這類變形後還有一點嵌進骨頭的，匯出時推回骨面。網格依大小簡化（0.2%，神經最多 0.1 mm、其他最多 0.25 mm）。不帶 `--zanatomy` 時已建好的 Z-Anatomy 部件原樣複製，只套用清單的名稱和系統。

肌肉起止點貼片另存在 `public/models/attachments.json`，第一次選構造時才下載（約 0.8 MB），見下面「起止點」。

筋膜（闊筋膜、胸腰筋膜、足底腱膜等）是獨立的「筋膜」系統，預設不顯示，因為打開會把肌肉整片蓋住。

給 Blender 腳本用的原始幾何：`node scripts/dump-atlas-geometry.mjs` 輸出到 `work/atlas-raw/`（不進版控）。BodyParts3D 原始 OBJ 的轉檔程式是 `scripts/convert-anatomy.py`（v0.7.0 以前的格式，留作來源紀錄）。

## 中文名稱

`app/names.zh-TW.json` 是中文譯名表：

- `terms`：英文名（小寫、去掉 left／right）→ 台灣用語。左右側由程式自動加「左／右」，例如 `Left femur` → 左股骨。
- `overrides`：整個名稱直接對照，給自動規則翻不好的少數名稱用。
- `reviewed`：校對過的 `terms` 鍵。不在這裡的名稱，App 會標「未校對」。

改完跑 `node scripts/validate-names.mjs`，它會檢查每個構造都有中文、沒有殘留英文、沒有沒用到的詞條。

人工校對用 `scripts/review-sheets.mjs`：`npm run review -- export <資料夾>` 依部位產生校對頁（Markdown 表格「英文名｜目前中文｜你的修改｜備註」，已填的修改重產時會保留），`npm run review -- apply <資料夾>` 把修改寫回譯名表，狀態改成「已校對」的頁面整頁加進 `reviewed`；「你的修改」以 `?` 開頭的是問題，不會套用。校對頁放在使用者自己的筆記裡，不進 repo。

## 肌肉卡

物理治療常用的 147 條肌肉（頸、肩、肘、腕手、胸腰、髖、膝、踝足、顳顎）各有一張卡：起點、止點、主要／次要作用、神經支配與神經根、血液供應、觸診提示、出處、備註；之後要加的徒手肌力測試、伸展、激痛點與轉移痛、常見損傷已在格式裡預留（`app/muscle-cards.ts`）。

卡片的正本是使用者筆記裡的 Markdown 頁（每個部位一頁，不進 repo），內容是自己寫的中文摘要並標出處（主要是 Neumann《Kinesiology of the Musculoskeletal System》第 3 版的附錄與表格頁碼），不整段抄原文書。每張卡是 `## 中文名 english name` 加上 `- **欄位**：內容` 的清單，`3D 模型` 那行用反引號列出對應的模型肌肉（英文小寫、不含 left/right）。

```sh
npm run cards -- check <資料夾>   # 檢查格式、模型肌肉、神經根寫法，列出待回答的意見、模型裡沒有的神經、還沒有卡片的肌肉
npm run cards -- apply <資料夾>   # 把全部的卡寫進 app/muscle-cards.json，記下哪些核對過
```

147 張卡全部進 App；頁面狀態是「已核對」（或單張卡標題後加 ✔）而且「你的意見」已清掉的記成 `reviewed`，其他的 App 標「未核對」。每張卡的英文維基百科條目（血液供應比對用、App 當出處連結）在 `scripts/muscle-card-wiki.json`。神經名稱跟模型的中文名一致時會記下模型的神經（`term`），App 用它從神經找支配的肌肉；分支關係（坐骨神經 → 脛神經、腓總神經 → 足底神經⋯⋯、臂神經叢的幹、股、束）在 `app/muscle-cards.ts` 的 `NERVE_BRANCHES`。`scripts/validate-cards.mjs` 檢查這份檔案（也在 `npm run validate` 裡）。

App 裡點一塊有卡的肌肉，面板就顯示這張卡（分段可收合，收合狀態記在這台裝置）；卡片上的神經可以點，會選取這條神經（含分支）和它支配的所有肌肉。點神經會列出它支配的肌肉（直接的、經哪條分支的），點骨頭會列出附著在上面的肌肉。

## 起止點

`public/models/attachments.json` 每塊貼片記著它屬於哪些模型肌肉（`muscles`）、起點或止點（`end`）、左右、貼在哪個部件上（`host`，骨頭為主，也有骨間膜、韌帶、白線、筋膜）、來源（`source`）。App 選到肌肉時把它整張卡的起點畫紅、止點畫藍，肌肉本身變半透明好看見底下的標色；「單獨顯示」時一起顯示它附著的骨頭；選到骨頭時畫出所有附著在上面的肌肉，點色塊可以選到那條肌肉。

兩種來源，都由 `npm run atlas` 產生：

- **Z-Anatomy 的貼片**（`z-anatomy`）。`scripts/zanatomy-select.mjs` 對到模型肌肉：名稱對得上的直接對；整條肌肉或共同肌腱的貼片（肱二頭肌止點、共同屈肌腱、髕韌帶止點等）用 `WHOLE` 對到每一個頭；起止點的叫法跟卡片相反的（肩帶肌、頸部肌群、腹斜肌等，卡片照 Neumann）用 `FLIP`、`PATCH` 改過來；不是肌肉的（足底長韌帶）和位置不對的（腹直肌沿整條白線那塊、尺側伸腕肌落在腕關節囊那塊，改用推算的）放進 `ATTACHMENT_OUT`。約五十塊標錯左右的依位置改正。
- **電腦推算的**（`computed`），補 Z-Anatomy 沒畫的端點：肌肉表面 2.5 mm 內（或嵌進肌肉）的骨面，要算哪些骨頭寫在 `scripts/attachment-contacts.json`（照卡片文字挑、排除只是貼著經過的骨頭，這就是人工修正的地方）。同一塊骨頭兩端都有的（多裂肌、迴旋肌、棘間肌、肋間肌）依位置切開：靠中線的棘突與椎板／外側的橫突與關節突，或上緣／下緣。App 會註明「有些位置是電腦推算」。

```sh
npm run attachments   # 檢查清單：貼片的起止點跟卡片相反？卡片寫了但沒有貼片的骨頭？整端都沒有的卡？
```

清單是拿卡片文字的骨頭關鍵字比對（`scripts/lib/bone-keywords.mjs`），每一條都要人看過再決定改不改。卡片改過起點、止點的寫法後也跑一次。`scripts/validate-attachments.mjs` 在 `npm run validate` 裡，檢查每塊貼片的肌肉、左右、附著部件和檔案。

## 肌肉分層

「剝層」工具用的層次在 `app/muscle-layers.json`，由 `npm run layers`（`scripts/compute-muscle-layers.mjs`）產生：在每塊肌肉表面取樣往外射線，沒被其他肌肉、骨頭、內臟擋住的算最淺層，剝掉再算下一層。物理治療常用肌群照教科書分層，寫在 `scripts/muscle-layer-overrides.json`（名稱用英文小寫、不含 left/right），改完重跑 `npm run layers`。上游把幾塊肌肉歸錯系統，修正表在 `app/system-fixes.ts`。

## 部位

部位快捷的裁切框在 `app/regions.ts`，由各部位的骨頭範圍自動算出，`scripts/validate-regions.mjs` 檢查大小與左右側。

部位選單上面的「身體區域」（上半身、下半身、頭頸、軀幹、上肢、下肢）不切：跨區的構造整塊顯示。手垂在骨盆和大腿旁邊，任何方框都會把手切掉或把大腿框進來，所以改成列出每區有哪些構造：`app/area-members.json`（部件 id → 所屬區域的位元，`keys` 是位元順序；四肢分左右），也由 `npm run members`（`scripts/compute-area-members.mjs`）產生：

- 骨架分段（頭、頸、胸、腹＝腰椎、薦尾骨、髖骨、上肢、下肢），全身每一點標上離它最近的骨頭屬於哪段（體素格，鎖骨不參與，免得頸根的頸總動脈、頭臂靜脈被算成上肢）。
- 骨頭：屬於它那段所在的區域；下肢另外帶同側髖骨。
- 肌肉、韌帶、筋膜、椎間盤、軟骨：附著在該區的「附著骨」上（肌肉用 `public/models/attachments.json` 起止點貼片所在的骨頭，沒有貼片的才用 4 mm 內碰到的骨頭），或附著骨全部在該區（骨盆底），或一半以上落在該區。附著骨：軀幹不算髖骨（否則大腿肌全進來）、下半身和下肢只算股骨以下（否則腹肌、闊背肌進來）；所以腰大肌上下半身都有、臀大肌在軀幹也在下肢。
- 其他（血管、神經、內臟）：三成以上落在該區；單側神經算下肢時把同側髖骨旁也算進去（坐骨神經、臀上神經）。
- 教科書歸屬的修正寫在 `scripts/area-member-overrides.json`（名稱或 `/樣式/`）：胸鎖乳突肌、舌骨下肌不算上肢，整個臂神經叢和鎖骨下動靜脈算上肢，臀靜脈算下肢，全身一整塊的皮膚不算任何半身等。

`node scripts/compute-area-members.mjs --report` 會列出每區的肌肉，`PARTS='right psoas major|urinary bladder'` 再印出指定構造的附著骨與各段比例，方便檢查。`scripts/validate-regions.mjs` 檢查位元順序、左右對稱和一批教科書例子（例如右手指骨在上半身不在下半身、膀胱在下半身不在下肢）。

每個構造屬於哪些部位記在 `app/region-members.json`，由 `npm run members`（`scripts/compute-region-members.mjs`）產生：骨頭屬於它定義的部位；肌肉、韌帶、筋膜、椎間盤、軟骨屬於它實際碰到（4 mm 內）的那些部位骨頭所在的部位，所以跨兩個關節的肌肉兩邊都算；周邊神經屬於有兩成以上落在部位框裡的那些部位；其他構造看包圍盒有沒有一半以上在部位框裡。算不到的教科書歸屬補在 `scripts/region-member-overrides.json`。校對頁和之後的測驗範圍都用這份。改了模型或部位定義要重跑。

## 3D 資料

以 **BodyParts3D 4.0**（成年男性參考模型）為主：2,223 個網格（原始 2,234 個，拿掉 5 個重複的和 6 個被取代的迴旋肌）。BodyParts3D 缺的肌肉、韌帶、關節囊與關節盤、滑囊、腱鞘、筋膜和周邊神經，由 **Z-Anatomy** 補上 898 個構造。合計 3,121 個可點選的部件、約 303 萬個三角面，第一次載入下載約 12.6 MB；起止點貼片 1,741 塊（Z-Anatomy 683＋推算 1,058）另外約 0.8 MB。完整出處與改動說明見 [public/ATTRIBUTION.md](public/ATTRIBUTION.md)。

- BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.
- Z-Anatomy - The libre 3D atlas of anatomy (Gauthier Kervyn et al.) - CC BY-SA 4.0. 其中腦神經取自 University of Dundee, CAHID 的 Cranial Nerves and Foramina（CC BY 4.0）。內耳（CC BY-NC-SA）、腎臟（CC BY-NC）和腦沒有拿。

本 App 為學習用途，不是診斷或手術工具。

## 授權

- 程式：MIT（見 [LICENSE](LICENSE)，保留原作者聲明）
- 3D 資料（`public/models/`）：整體以 **CC BY-SA 4.0** 公開（含 Z-Anatomy 改作的部分，必須同授權；BodyParts3D 部分原為 CC BY 4.0），轉發時要保留出處，見 [public/models/LICENSE.md](public/models/LICENSE.md)
- 第三方套件依各自授權
