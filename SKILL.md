---
name: media-gate
description: 付費或會員限定的影片、音檔、HLS 串流、下載檔要防止「直接連檔案網址就繞過付費牆」時使用。使用者說「影片被直連下載」「檔案網址外流」「付費內容保護」「簽章網址」時觸發。簽章 token、路徑穿越防護、HLS 分段授權，零依賴。
---

# media-gate — 打法

**頁面擋住了不算數，檔案本身也要擋。** 只有拿到有效簽章 token 的請求才讀得到檔案，而 token 只在你判定對方有權觀看時才發。

## 何時觸發

- 有付費牆或會員限定內容，而檔案是自己的伺服器在送（`/files/...`、`/hls/...`）
- 發現內容頁有擋、但檔案網址貼到別的瀏覽器照樣能看
- 任何「把使用者給的路徑接到資料夾後面再讀檔」的程式 → 至少用 `safeJoin`

**不適用**：檔案放在物件儲存或 CDN 上（用它們自己的簽章網址）。

## 接線（照抄能跑）

```bash
npm i github:Jeffrey0117/media-gate
```

```js
const gate = require('media-gate')({ secret: process.env.MEDIA_SECRET }); // 沒設會直接 throw

// 1. 內容頁：你的付費牆判斷通過了才發 token
const token = gate.signToken(record.id, user.id);
const videoUrl = `/files/${record.path}?t=${token}`;

// 2. 送檔案：先解碼、再組路徑、再驗 token、再綁本人與這一筆
const abs = gate.safeJoin(MEDIA_DIR, decodeURIComponent(reqPath));
if (!abs) return send403(res);
const p = gate.verifyToken(query.t);
const me = getUser(req);
const rec = p && db.getRecord(p.resourceId);
if (!p || !me || String(me.id) !== p.subjectId || !rec || rec.path !== gate.relFrom(MEDIA_DIR, abs)) {
  return send403(res);
}
stream(abs, res);

// 3. HLS：播放清單要改寫，後面的分段請求才帶得到 token
if (abs.endsWith('.m3u8')) return res.end(gate.rewriteM3U8(fs.readFileSync(abs, 'utf8'), query.t));
```

## 模式

- **五道檢查缺一不可**：路徑沒跑出資料夾、簽章正確沒過期、token 是發給這個人的、token 是發給這一筆的、請求的檔案真的屬於這一筆。少了「綁本人」，分享連結就能看；少了「綁這一筆」，買一部就能看全部。
- **只擋要收費的資料夾。** 縮圖、預覽片段留公開，列表頁才不會壞。
- **token 每次開內容頁重發**，所以效期短沒關係；`ttlMs` 要蓋得住一次完整的觀看（預設兩小時）。
- **撞到付費牆就不發 token**，對方連檔案網址都組不出來。
- `secret` 用專屬的私有值，不要跟 session 共用一把，也不要有預設值。

## 地雷

- **`verifyToken` 回來的 `resourceId` 和 `subjectId` 都是字串。** 使用者 id 是數字的話，`me.id !== p.subjectId` 永遠成立，所有人都被擋。比較前先 `String(me.id)`。
- **id 裡不能有分隔字元。** token 內部用 `~` 把資源 id、對象 id、到期時間接在一起；id 本身含 `~` 的 token 一律驗不過（0.1.1 起；之前會解析錯位，到期時間失效）。id 可能含 `~` 時，建立時傳 `sep` 換一個不會出現的字元。
- **路徑要先解碼再給 `safeJoin`，之後只用它回傳的路徑。** 先檢查、後解碼，`%2e%2e` 就能溜過去。
- **`safeJoin` 不會解析符號連結。** 資料夾裡有指向外面的連結時，它不會擋。
- **`rewriteM3U8` 只改非 `#` 開頭的行。** 寫在標籤裡的網址不會被改：`#EXT-X-KEY` 的金鑰、`#EXT-X-MAP` 的初始化分段、`#EXT-X-MEDIA` 的替代音軌都拿不到 token。用到加密 HLS、fMP4 或多音軌時，這些網址要自己補上 token，或另外放行。
- **token 在網址裡**，會進存取紀錄和 Referer。效期別設太長，而且一定要綁本人，外流的網址才沒用。
- **發出去的 token 收不回來**，只能等它過期。退款或停權後要立刻擋，得在送檔案那一步再查一次權限。
- **影片比 `ttlMs` 長會播到一半斷掉**（後面的分段請求時 token 已過期）。長片把 `ttlMs` 調大。
