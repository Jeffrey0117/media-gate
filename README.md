<p align="center">
  <img src="logo.svg" width="96" height="96" alt="media-gate logo">
</p>

# media-gate 🔒

**自架媒體站的存取防護。** 讓影片/HLS 內容**不能被直連下載繞過付費牆**。
簽章 token + 路徑穿越防護 + HLS 分段授權。**零依賴**（只用 node 內建 `crypto`/`path`）、框架無關。

> 付費牆/會員影片站最常見的洞：頁面擋了、**檔案卻世界可讀** —— 直接連 `/files/xxx.mp4` 就繞過。
> media-gate 讓內容只給「拿到有效簽章 token 的人」，而 token 只在你判定他有權觀看時才發。

## 安裝（擇一）

```bash
npm i github:Jeffrey0117/media-gate     # 或直接複製 index.js（零依賴）
```

## 概念

```
使用者開內容頁 → 你判斷他有權看 → gate.signToken(recordId, userId) → 網址帶 ?t=token
服務媒體檔      → gate.verifyToken(t) + gate.safeJoin(dir, path) + 綁本人 → 放行 / 403
撞付費牆        → 不發 token → 連檔案網址都構造不出來
```

## API

`createMediaGate({ secret, ttlMs?, sep? })` → 下列五個純函式（`secret` 必填，用**私有**值）

| 方法 | 說明 |
|---|---|
| `signToken(resourceId, subjectId)` | 發 HMAC-SHA256 token，綁資源 id + 對象 id + 到期（`ttlMs`，預設 2h）。 |
| `verifyToken(token)` | 回 `{resourceId, subjectId, exp}` 或 `null`（簽章錯/過期/格式錯）。`timingSafeEqual`、**永不 throw**。 |
| `safeJoin(baseDir, userPath)` | 安全組路徑：解析後仍在 `baseDir` 內才回絕對路徑，否則 `null`（擋 `../` 讀到 DB/.env）。 |
| `relFrom(baseDir, resolved)` | 已解析路徑對 `baseDir` 的相對路徑（正斜線，好跟 DB 比對）。 |
| `rewriteM3U8(text, token)` | 把 `?t=token` 補到 m3u8 每個非註解行（子清單+分段都帶授權）。 |

## 接進 http server（真實範例）

```js
const gate = require('media-gate')({ secret: process.env.SESSION_SECRET }); // 私有 secret！

// ── 內容頁：判定有權觀看時發 token ──
// (你的付費牆邏輯：登入？試看次數？tier？通過了才 signToken)
const token = gate.signToken(record.id, user.id);
const videoUrl = `/files/${record.path}?t=${token}`;
const hlsUrl   = `/hls/${record.id}/master.m3u8?t=${token}`;

// ── 服務影片檔 /files ──
const abs = gate.safeJoin(MEDIA_DIR, reqPath);          // 1. 路徑穿越防護
if (!abs) return send403(res);
const rel = gate.relFrom(MEDIA_DIR, abs);
if (rel.startsWith('videos/') && !isAdmin(req)) {        // 2. 只擋要保護的（圖片可留公開）
  const p = gate.verifyToken(query.t);                   // 3. 驗 token
  const me = getUser(req);                               // 4. 綁本人：擋分享連結
  const rec = p && db.getRecord(p.resourceId);           // 5. 綁該筆：擋拿別筆 token
  if (!p || !me || me.id !== p.subjectId || !rec || rec.path !== rel) return send403(res);
}
stream(abs, res);

// ── 服務 HLS /hls：m3u8 要改寫，分段才帶得到 token ──
const absHls = gate.safeJoin(HLS_DIR, reqPath);
if (!absHls) return send403(res);
const recordId = gate.relFrom(HLS_DIR, absHls).split('/')[0];
if (!isAdmin(req)) {
  const p = gate.verifyToken(query.t);
  const me = getUser(req);
  if (!p || p.resourceId !== recordId || !me || me.id !== p.subjectId) return send403(res);
}
if (absHls.endsWith('.m3u8')) return res.end(gate.rewriteM3U8(fs.readFileSync(absHls, 'utf8'), query.t));
stream(absHls, res);
```

## 五道防線（都在上面那段）

1. **路徑穿越** → `safeJoin` 回 null 就擋（不然 `../../lurl.db` 讀走你的 DB）
2. **只擋該擋的** → 縮圖/預覽/圖片可維持公開，不破壞瀏覽頁
3. **簽章** → 沒 token / 竄改 / 過期 → 擋
4. **綁本人**（`subjectId`）→ 把 `?t=` 連結分享給別人也沒用
5. **綁該筆**（`resourceId`）→ 拿 A 的 token 抓不到 B

## 心法

- `secret` 一定要**私有**（別 fallback 到任何公開/預設值，否則 token 可偽造）。
- `ttlMs` 跟影片長度無關，是「授權網址能用多久」——涵蓋一次瀏覽 session 即可（預設 2h）。
- 只擋「真正要收費」的目錄；縮圖/預覽留公開，體驗才順。
- token 每次開內容頁重發，所以短效沒關係。

## License

MIT © Jeffrey0117
