// ============================================================================
// media-gate — 自架媒體站的存取防護（簽章 token + 路徑穿越防護 + HLS 授權）
// ----------------------------------------------------------------------------
// 零依賴（只用 node 內建 crypto / path）。框架無關：給你四個純函式，
// 你自己接到任何 http server（怎麼查記錄、怎麼認 admin、怎麼認登入者由你注入）。
//
// 解決什麼：付費牆/會員影片站最常見的洞——內容檔(/files, /hls)世界可讀，
// 只擋了頁面沒擋檔，直接連檔案網址就繞過。這個 kit 讓內容只給「有授權的人」。
//
// 用法：
//   const gate = require('media-gate')({ secret: process.env.SESSION_SECRET, ttlMs: 2*60*60*1000 });
//   // 判斷使用者有權觀看某筆內容時：
//   const token = gate.signToken(recordId, userId);           // 塞進媒體網址 ?t=token
//   // 服務媒體檔時：
//   const payload = gate.verifyToken(req.query.t);             // null=擋
//   const abs = gate.safeJoin(MEDIA_DIR, userSuppliedPath);    // null=路徑穿越，擋
//   const playlist = gate.rewriteM3U8(m3u8text, req.query.t);  // HLS 分段也帶上授權
// ============================================================================
const crypto = require('crypto');
const path = require('path');

module.exports = function createMediaGate(opts = {}) {
  const secret = opts.secret;
  if (!secret) throw new Error('media-gate: opts.secret is required (用私有 secret，別用公開/預設值)');
  const ttlMs = opts.ttlMs || 2 * 60 * 60 * 1000; // 預設 2 小時
  const sep = opts.sep || '~';

  // 發一張綁 resourceId + subjectId + 到期的 HMAC-SHA256 token。
  function signToken(resourceId, subjectId) {
    const exp = Date.now() + ttlMs;
    const b64 = Buffer.from(`${resourceId}${sep}${subjectId == null ? 'anon' : subjectId}${sep}${exp}`).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
    return b64 + '.' + sig;
  }

  // 驗證 token。回 { resourceId, subjectId, exp } 或 null（簽章錯/過期/格式錯）。永不 throw。
  function verifyToken(token) {
    try {
      if (!token) return null;
      const i = String(token).indexOf('.');
      if (i < 0) return null;
      const b64 = token.slice(0, i), sig = token.slice(i + 1);
      const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
      const a = Buffer.from(sig), b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      const [resourceId, subjectId, exp] = Buffer.from(b64, 'base64url').toString('utf8').split(sep);
      if (!resourceId || !exp || Date.now() > Number(exp)) return null;
      return { resourceId, subjectId, exp: Number(exp) };
    } catch (e) { return null; }
  }

  // 安全組路徑：解析後必須仍在 baseDir 內，否則回 null（擋 ../ 讀到 DB/.env 等任意檔）。
  function safeJoin(baseDir, userPath) {
    const root = path.resolve(baseDir);
    const resolved = path.resolve(root, String(userPath || ''));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
  }

  // baseDir 到某個已解析路徑的相對路徑（用正斜線，方便跟 DB 存的路徑比對）。
  function relFrom(baseDir, resolved) {
    return path.relative(path.resolve(baseDir), resolved).split(path.sep).join('/');
  }

  // 把 token 補到 m3u8 每個非註解行（子清單/分段），讓後續請求也帶得到授權。
  function rewriteM3U8(text, token) {
    return String(text).split('\n').map(function (line) {
      const t = line.trim();
      if (!t || t.startsWith('#')) return line;
      return line + (t.indexOf('?') >= 0 ? '&' : '?') + 't=' + token;
    }).join('\n');
  }

  return { signToken, verifyToken, safeJoin, relFrom, rewriteM3U8, ttlMs };
};
